"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createAdminClient, createSessionClient } from "@/lib/appwrite/server";
import { SESSION_COOKIE } from "@/lib/appwrite/config";
import { clearSessionCookie, memberStatusFor, setSessionCookie } from "@/lib/auth";

export type LoginState = { error: string | null };

const INVALID = "Incorrect email or password.";
const NOT_INVITED = "This account has not been invited.";

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const { account, users } = createAdminClient();

  // Created with the API key so Appwrite returns `session.secret`.
  let session;
  try {
    session = await account.createEmailPasswordSession(email, password);
  } catch {
    return { error: INVALID };
  }

  const status = await memberStatusFor(session.userId);
  if (!status.member) {
    await users.deleteSession(session.userId, session.$id).catch(() => {});
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
