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
