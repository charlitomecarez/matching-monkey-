export type Membership = {
  $id: string;
  userId: string;
  teamId: string;
  roles: string[];
  confirm: boolean;
};

export type MemberStatus = { member: boolean; admin: boolean; membershipId: string | null };

/** Member only via a confirmed membership of `teamId`; admin if that membership has the "owner" role. */
export function memberStatus(memberships: Membership[], teamId: string): MemberStatus {
  const confirmed = memberships.filter((m) => m.teamId === teamId && m.confirm === true);
  if (confirmed.length === 0) return { member: false, admin: false, membershipId: null };
  const owner = confirmed.find((m) => m.roles.includes("owner"));
  const chosen = owner ?? confirmed[0];
  return { member: true, admin: Boolean(owner), membershipId: chosen.$id };
}
