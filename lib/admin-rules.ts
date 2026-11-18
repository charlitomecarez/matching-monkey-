import type { Membership } from "./access";

export type AdminChange = "revoke" | "demote" | "promote" | "delete";

const isConfirmedOwner = (m: Membership) => m.confirm && m.roles.includes("owner");

/**
 * Guardrails for admin actions. Returns an error message, or null when allowed.
 * - Nobody can revoke, demote or delete themselves.
 * - The last confirmed owner (admin) cannot be revoked, demoted or deleted.
 */
export function checkAdminChange(
  actorUserId: string,
  target: Membership,
  all: Membership[],
  change: AdminChange,
): string | null {
  if (change === "promote") return null;
  if (target.userId === actorUserId) return "You can't change your own access.";
  if (isConfirmedOwner(target)) {
    const owners = all.filter((m) => isConfirmedOwner(m) && m.teamId === target.teamId);
    if (owners.filter((m) => m.$id !== target.$id).length === 0) return "There must be at least one admin.";
  }
  return null;
}

export type MemberStatusLabel = "joined" | "invited" | "no access";

export type MemberRow = {
  /** null when the user has no membership in the team (never invited, or revoked). */
  membershipId: string | null;
  userId: string;
  email: string;
  name: string;
  status: MemberStatusLabel;
  admin: boolean;
};

export type UserInfo = { $id: string; email: string; name: string };
export type TeamMembershipInfo = {
  $id: string;
  userId: string;
  userEmail: string;
  userName: string;
  roles: string[];
  confirm: boolean;
};

/**
 * One row per team membership, then one "no access" row per project user without a membership
 * (revoked or never invited), so admins can still permanently delete them.
 */
export function mergeMembers(users: UserInfo[], memberships: TeamMembershipInfo[]): MemberRow[] {
  const rows: MemberRow[] = memberships.map((m) => ({
    membershipId: m.$id,
    userId: m.userId,
    email: m.userEmail,
    name: m.userName,
    status: m.confirm ? "joined" : "invited",
    admin: m.roles.includes("owner"),
  }));
  const inTeam = new Set(memberships.map((m) => m.userId));
  for (const u of users) {
    if (inTeam.has(u.$id)) continue;
    rows.push({ membershipId: null, userId: u.$id, email: u.email, name: u.name, status: "no access", admin: false });
  }
  return rows;
}
