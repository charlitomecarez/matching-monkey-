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

  try {
    await createPublicClient().teams.updateMembershipStatus({ teamId, membershipId, userId, secret });
  } catch {
    return { error: INVALID };
  }

  const { users } = createAdminClient();
  let session;
  try {
    await users.updatePassword({ userId, password });
    session = await users.createSession({ userId });
  } catch (e) {
    console.error(e);
    return { error: "Your invite was accepted, but setting the password failed. Ask an admin to invite you again." };
  }

  await setSessionCookie(session.secret, session.expire);
  redirect("/");
}
