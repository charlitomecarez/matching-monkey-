import { describe, expect, it } from "vitest";
import { checkAdminChange, mergeMembers } from "./admin-rules";
import type { Membership } from "./access";

const TEAM = "members";
const SELF = "You can't change your own access.";
const LAST = "There must be at least one admin.";

function m(id: string, userId: string, over: Partial<Membership> = {}): Membership {
  return { $id: id, userId, teamId: TEAM, roles: [], confirm: true, ...over };
}

const owner = m("m1", "admin1", { roles: ["owner"] });
const owner2 = m("m2", "admin2", { roles: ["owner"] });
const member = m("m3", "user3");
const invitedOwner = m("m4", "user4", { roles: ["owner"], confirm: false });

describe("checkAdminChange", () => {
  it("refuses revoking yourself", () => {
    expect(checkAdminChange("admin1", owner, [owner, owner2], "revoke")).toBe(SELF);
  });

  it("refuses deleting yourself", () => {
    expect(checkAdminChange("admin1", owner, [owner, owner2], "delete")).toBe(SELF);
  });

  it("refuses demoting yourself", () => {
    expect(checkAdminChange("admin1", owner, [owner, owner2], "demote")).toBe(SELF);
  });

  it("refuses demoting the only owner", () => {
    expect(checkAdminChange("other", owner, [owner, member], "demote")).toBe(LAST);
  });

  it("refuses revoking or deleting the only owner", () => {
    expect(checkAdminChange("other", owner, [owner, member], "revoke")).toBe(LAST);
    expect(checkAdminChange("other", owner, [owner, member], "delete")).toBe(LAST);
  });

  it("allows demoting one of two owners", () => {
    expect(checkAdminChange("admin1", owner2, [owner, owner2, member], "demote")).toBeNull();
  });

  it("counts only confirmed owners", () => {
    expect(checkAdminChange("other", owner, [owner, invitedOwner], "demote")).toBe(LAST);
  });

  it("allows revoking an invited-but-not-joined membership", () => {
    expect(checkAdminChange("admin1", invitedOwner, [owner, invitedOwner], "revoke")).toBeNull();
  });

  it("allows promoting anyone", () => {
    expect(checkAdminChange("admin1", member, [owner, member], "promote")).toBeNull();
  });

  it("allows revoking and deleting a regular member", () => {
    expect(checkAdminChange("admin1", member, [owner, member], "revoke")).toBeNull();
    expect(checkAdminChange("admin1", member, [owner, member], "delete")).toBeNull();
  });
});

describe("mergeMembers", () => {
  const users = [
    { $id: "u1", email: "a@x.com", name: "A" },
    { $id: "u2", email: "b@x.com", name: "B" },
    { $id: "u3", email: "c@x.com", name: "" },
  ];
  const memberships = [
    { $id: "m1", userId: "u1", userEmail: "a@x.com", userName: "A", roles: ["owner"], confirm: true },
    { $id: "m2", userId: "u2", userEmail: "b@x.com", userName: "B", roles: [], confirm: false },
  ];

  it("marks joined, invited and no-access users", () => {
    expect(mergeMembers(users, memberships)).toEqual([
      { membershipId: "m1", userId: "u1", email: "a@x.com", name: "A", status: "joined", admin: true },
      { membershipId: "m2", userId: "u2", email: "b@x.com", name: "B", status: "invited", admin: false },
      { membershipId: null, userId: "u3", email: "c@x.com", name: "", status: "no access", admin: false },
    ]);
  });

  it("keeps a membership whose user is missing from the user list", () => {
    const rows = mergeMembers([], [memberships[1]]);
    expect(rows).toEqual([
      { membershipId: "m2", userId: "u2", email: "b@x.com", name: "B", status: "invited", admin: false },
    ]);
  });

  it("never marks a no-access user as admin", () => {
    expect(mergeMembers([users[2]], [])[0]).toMatchObject({ status: "no access", admin: false, membershipId: null });
  });
});
