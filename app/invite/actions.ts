"use server";

import { redirect } from "next/navigation";
import { createAdminClient, createPublicClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { setSessionCookie } from "@/lib/auth";

export type InviteState = { error: string | null };

const INVALID = "This invite link is invalid or was already used.";

export async function acceptInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const userId = field("userId");
  const membershipId = field("membershipId");
  const secret = field("secret");
  const teamId = field("teamId");
  const password = field("password");
  const confirm = field("confirm");

  if (!userId || !membershipId || !secret || teamId !== IDS.team) return { error: INVALID };
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  if (password !== confirm) return { error: "The passwords don't match." };

  const { teams, users } = createAdminClient();

  // The membership must exist, be for this user and still be pending before anything is changed.
  try {
    const membership = await teams.getMembership({ teamId: IDS.team, membershipId });
    if (membership.userId !== userId || membership.confirm) return { error: INVALID };
  } catch {
    return { error: INVALID };
  }

  // A revoked user is blocked (app/admin/actions.ts revokeMember). Unblock for the accept, and
  // block again if the invite secret turns out to be wrong.
  let unblocked = false;
  try {
    const account = await users.get({ userId });
    if (!account.status) {
      await users.updateStatus({ userId, status: true });
      unblocked = true;
    }
  } catch (e) {
    console.error(e);
    return { error: "Could not accept the invite. Try again." };
  }

  try {
    await createPublicClient().teams.updateMembershipStatus({ teamId, membershipId, userId, secret });
  } catch {
    if (unblocked) {
      await users.updateStatus({ userId, status: false }).catch((e) => console.error("Could not re-block user", e));
    }
    return { error: INVALID };
  }

  let session;
  try {
    // End every existing session first: someone who signed up with this email before the invite
    // (or knows the old password) must not stay signed in once the invitee sets a password.
    await users.deleteSessions({ userId });
    await users.updatePassword({ userId, password });
    session = await users.createSession({ userId });
  } catch (e) {
    console.error(e);
    return { error: "Your invite was accepted, but setting the password failed. Ask an admin to invite you again." };
  }

  await setSessionCookie(session.secret, session.expire);
  redirect("/");
}
