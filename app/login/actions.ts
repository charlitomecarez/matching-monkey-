"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Query, type Models } from "node-appwrite";
import { createAdminClient, createSessionClient } from "@/lib/appwrite/server";
import { SESSION_COOKIE } from "@/lib/appwrite/config";
import { clearSessionCookie, memberStatusFor, setSessionCookie } from "@/lib/auth";
import { LOCKED_OUT_MESSAGE, isLockedOut, nextThrottle } from "@/lib/login-throttle";

export type LoginState = { error: string | null };

const INVALID = "Incorrect email or password.";
const NOT_INVITED = "This account has not been invited.";

type Users = ReturnType<typeof createAdminClient>["users"];

/** The project user with this email, or null (unknown emails are not tracked). */
async function findUser(users: Users, email: string): Promise<Models.User<Models.Preferences> | null> {
  const emails = [...new Set([email, email.toLowerCase()])];
  const { users: found } = await users.list({ queries: [Query.equal("email", emails), Query.limit(1)] });
  return found[0] ?? null;
}

/** Merges the throttle fields into the user's existing prefs (updatePrefs replaces the whole object). */
async function recordAttempt(users: Users, user: Models.User<Models.Preferences>, outcome: "success" | "failure") {
  const prefs = user.prefs as Record<string, unknown>;
  await users
    .updatePrefs({ userId: user.$id, prefs: { ...prefs, ...nextThrottle(prefs, Date.now(), outcome) } })
    .catch((e) => console.error("Could not update the login throttle", e));
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const { account, users } = createAdminClient();

  // Per-email throttle: API-key requests skip Appwrite's own rate limits, so this action counts
  // failures itself (in the user's prefs) and stops checking passwords after too many.
  let user: Models.User<Models.Preferences> | null;
  try {
    user = await findUser(users, email);
  } catch (e) {
    console.error(e);
    return { error: "Couldn't sign in right now. Try again." };
  }
  if (user && isLockedOut(user.prefs as Record<string, unknown>, Date.now())) return { error: LOCKED_OUT_MESSAGE };

  // Created with the API key so Appwrite returns `session.secret`.
  let session;
  try {
    session = await account.createEmailPasswordSession({ email, password });
  } catch {
    if (user) await recordAttempt(users, user, "failure");
    return { error: INVALID };
  }
  if (user && (user.prefs as Record<string, unknown>).loginFailures) await recordAttempt(users, user, "success");

  const status = await memberStatusFor(session.userId);
  if (!status.member) {
    await users.deleteSession({ userId: session.userId, sessionId: session.$id }).catch(() => {});
    return { error: NOT_INVITED };
  }

  await setSessionCookie(session.secret, session.expire);
  redirect("/");
}

export async function logout(): Promise<void> {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value;
  if (secret) {
    await createSessionClient(secret)
      .account.deleteSession("current")
      .catch(() => {}); // Already expired or deleted: still clear the cookie.
  }
  await clearSessionCookie();
  redirect("/login");
}
