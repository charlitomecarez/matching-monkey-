import { describe, expect, it } from "vitest";
import { memberStatus, type Membership } from "./access";

const TEAM = "members";

function m(over: Partial<Membership>): Membership {
  return { $id: "m1", userId: "u1", teamId: TEAM, roles: [], confirm: true, ...over };
}

describe("memberStatus", () => {
  it("rejects an unconfirmed membership", () => {
    expect(memberStatus([m({ confirm: false })], TEAM)).toEqual({ member: false, admin: false, membershipId: null });
  });

  it("rejects memberships of other teams only", () => {
    expect(memberStatus([m({ teamId: "other", roles: ["owner"] })], TEAM)).toEqual({
      member: false,
      admin: false,
      membershipId: null,
    });
  });

  it("rejects an empty list", () => {
    expect(memberStatus([], TEAM).member).toBe(false);
  });

  it("accepts a confirmed member without roles as non-admin", () => {
    expect(memberStatus([m({ $id: "abc" })], TEAM)).toEqual({ member: true, admin: false, membershipId: "abc" });
  });

  it("marks a confirmed owner as admin", () => {
    expect(memberStatus([m({ roles: ["owner"] })], TEAM)).toEqual({ member: true, admin: true, membershipId: "m1" });
  });

  it("ignores an unconfirmed owner membership and picks the confirmed one", () => {
    const list = [m({ $id: "x", confirm: false, roles: ["owner"] }), m({ $id: "y" })];
    expect(memberStatus(list, TEAM)).toEqual({ member: true, admin: false, membershipId: "y" });
  });
});
