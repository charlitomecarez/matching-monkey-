import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createAdminClient, createSessionClient } from "./appwrite/server";
import { IDS, SESSION_COOKIE } from "./appwrite/config";
import { memberStatus, type MemberStatus } from "./access";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  admin: boolean;
  membershipId: string;
  secret: string;
};

/** Thrown by requireMember / requireAdmin. 401 = not signed in, 403 = signed in but not allowed. */
export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message = status === 401 ? "Not signed in." : "Forbidden.") {
    super(message);
    this.name = "AuthError";
  }
}

/** Membership status of a user in the members team, looked up with the API key. */
export async function memberStatusFor(userId: string): Promise<MemberStatus> {
  const { users } = createAdminClient();
  const { memberships } = await users.listMemberships(userId);
  return memberStatus(memberships, IDS.team);
}

type Resolved = { state: "anonymous" } | { state: "forbidden" } | { state: "ok"; user: CurrentUser };

/** Reads the session cookie and resolves it once per request. */
const resolve = cache(async (): Promise<Resolved> => {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!secret) return { state: "anonymous" };

  let account;
  try {
    account = await createSessionClient(secret).account.get();
  } catch {
    // Expired, deleted or forged session.
    return { state: "anonymous" };
  }

  const status = await memberStatusFor(account.$id);
  if (!status.member || !status.membershipId) return { state: "forbidden" };

  return {
    state: "ok",
    user: {
      id: account.$id,
      email: account.email,
      name: account.name,
      admin: status.admin,
      membershipId: status.membershipId,
      secret,
    },
  };
});

/** The signed-in team member, or null. Reads cookies: render callers inside <Suspense>. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const r = await resolve();
  return r.state === "ok" ? r.user : null;
}

export async function requireMember(): Promise<CurrentUser> {
  const r = await resolve();
  if (r.state === "anonymous") throw new AuthError(401);
  if (r.state === "forbidden") throw new AuthError(403);
  return r.user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireMember();
  if (!user.admin) throw new AuthError(403);
  return user;
}

/** Only callable from a Server Action or Route Handler. */
export async function setSessionCookie(secret: string, expire: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expire),
  });
}

/** Only callable from a Server Action or Route Handler. */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
