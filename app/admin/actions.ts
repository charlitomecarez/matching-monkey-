"use server";

import { refresh } from "next/cache";
import { AppwriteException, Query } from "node-appwrite";
import { createAdminClient, createSessionClient } from "@/lib/appwrite/server";
import { APP_URL, IDS } from "@/lib/appwrite/config";
import { AuthError, requireAdmin, type CurrentUser } from "@/lib/auth";
import { checkAdminChange, mergeMembers, type AdminChange, type MemberRow } from "@/lib/admin-rules";
import type { Membership } from "@/lib/access";

export type ActionResult = { error: string | null };


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE = 100;

type Guarded = { user: CurrentUser; error: null } | { user: null; error: string };

async function guard(): Promise<Guarded> {
  try {
    return { user: await requireAdmin(), error: null };
  } catch (e) {
    if (e instanceof AuthError) return { user: null, error: e.status === 401 ? "Your session has expired. Sign in again." : "Admins only." };
    throw e;
  }
}

function appwriteMessage(e: unknown, fallback: string): string {
  if (e instanceof AppwriteException) {
    if (e.code === 409) return "That email has already been invited or is already a member.";
    if (e.code === 404) return "That member no longer exists. Refresh the page.";
    if (e.code === 401) return "Appwrite refused the request. Make sure you are still an admin.";
    if (e.code === 429) return "Too many requests. Try again in a minute.";
  }
  console.error(e);
  return fallback;
}

/** All memberships of the members team, paged with the API key. */
async function allMemberships() {
  const { teams } = createAdminClient();
  const out = [];
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const { memberships } = await teams.listMemberships({ teamId: IDS.team, queries });
    out.push(...memberships);
    if (memberships.length < PAGE) return out;
    cursor = memberships[memberships.length - 1].$id;
  }
}

const toMembership = (m: { $id: string; userId: string; teamId: string; roles: string[]; confirm: boolean }): Membership => ({
  $id: m.$id,
  userId: m.userId,
  teamId: m.teamId,
  roles: m.roles,
  confirm: m.confirm,
});

/** Loads the team and runs the guardrails for a change to `membershipId`. */
async function checkChange(actor: CurrentUser, membershipId: string, change: AdminChange) {
  const all = (await allMemberships()).map(toMembership);
  const target = all.find((m) => m.$id === membershipId);
  if (!target) return { target: null, error: "That member no longer exists. Refresh the page." };
  return { target, error: checkAdminChange(actor.id, target, all, change) };
}

/** All project users, paged with the API key. */
async function allUsers() {
  const { users } = createAdminClient();
  const out = [];
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await users.list({ queries });
    out.push(...page.users);
    if (page.users.length < PAGE) return out;
    cursor = page.users[page.users.length - 1].$id;
  }
}

/** Team memberships plus project users without one ("no access": revoked or never invited). */
export async function listMembers(): Promise<MemberRow[]> {
  await requireAdmin();
  const [users, memberships] = await Promise.all([allUsers(), allMemberships()]);
  return mergeMembers(users, memberships);
}

export async function inviteMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, error } = await guard();
  if (!user) return { error };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (!APP_URL) return { error: "APP_URL is not configured on the server." };

  try {
    // Must run as the admin's own session: with the API key Appwrite adds the member silently and sends no email.
    await createSessionClient(user.secret).teams.createMembership({
      teamId: IDS.team,
      roles: [],
      email,
      url: `${APP_URL}/invite`,
    });
  } catch (e) {
    return { error: appwriteMessage(e, "Could not send the invite. Try again.") };
  }
  refresh();
  return { error: null };
}

/** Removes access. The user's data is kept; re-inviting the same email restores it. */
export async function revokeMember(membershipId: string): Promise<ActionResult> {
  const { user, error } = await guard();
  if (!user) return { error };

  try {
    const check = await checkChange(user, membershipId, "revoke");
    if (check.error || !check.target) return { error: check.error };
    const { teams, users } = createAdminClient();
    await teams.deleteMembership({ teamId: IDS.team, membershipId });
    await users.deleteSessions({ userId: check.target.userId }).catch((e) => {
      if (!isNotFound(e)) throw e; // An invited user may have no account yet.
    });
  } catch (e) {
    return { error: appwriteMessage(e, "Could not revoke access. Try again.") };
  }
  refresh();
  return { error: null };
}

export async function setAdmin(membershipId: string, admin: boolean): Promise<ActionResult> {
  const { user, error } = await guard();
  if (!user) return { error };

  try {
    const check = await checkChange(user, membershipId, admin ? "promote" : "demote");
    if (check.error) return { error: check.error };
    await createSessionClient(user.secret).teams.updateMembership({
      teamId: IDS.team,
      membershipId,
      roles: admin ? ["owner"] : [],
    });
  } catch (e) {
    return { error: appwriteMessage(e, "Could not change admin rights. Try again.") };
  }
  refresh();
  return { error: null };
}

function isNotFound(e: unknown) {
  return e instanceof AppwriteException && e.code === 404;
}

/**
 * Permanently deletes a user, all their uploads rows and both files of each row.
 * `confirmEmail` must equal the user's email (typed by the admin as confirmation).
 */
export async function deleteUserAndData(userId: string, confirmEmail: string): Promise<ActionResult> {
  const { user, error } = await guard();
  if (!user) return { error };

  const { users, tables, storage } = createAdminClient();
  try {
    const all = (await allMemberships()).map(toMembership);
    // A user without a membership (already revoked) is checked as a plain non-member.
    const target = all.find((m) => m.userId === userId) ?? {
      $id: "",
      userId,
      teamId: IDS.team,
      roles: [],
      confirm: false,
    };
    const ruleError = checkAdminChange(user.id, target, all, "delete");
    if (ruleError) return { error: ruleError };

    const account = await users.get({ userId });
    if (confirmEmail.trim().toLowerCase() !== account.email.toLowerCase()) {
      return { error: "The email you typed does not match this user." };
    }

    // Delete rows page by page; always re-read the first page since deleted rows drop out.
    for (;;) {
      const { rows } = await tables.listRows({
        databaseId: IDS.database,
        tableId: IDS.uploads,
        queries: [Query.equal("ownerId", userId), Query.limit(PAGE)],
      });
      for (const row of rows) {
        for (const [bucketId, fileId] of [
          [IDS.originals, row.originalFileId],
          [IDS.states, row.stateFileId],
        ] as const) {
          if (typeof fileId !== "string" || !fileId) continue;
          await storage.deleteFile({ bucketId, fileId }).catch((e) => {
            if (!isNotFound(e)) throw e;
          });
        }
        await tables.deleteRow({ databaseId: IDS.database, tableId: IDS.uploads, rowId: row.$id }).catch((e) => {
          if (!isNotFound(e)) throw e;
        });
      }
      if (rows.length < PAGE) break;
    }

    await users.delete({ userId });
  } catch (e) {
    return { error: appwriteMessage(e, "Could not delete the user. Try again.") };
  }
  refresh();
  return { error: null };
}
