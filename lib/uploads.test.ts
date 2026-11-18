import { describe, expect, it } from "vitest";
import {
  NotFound,
  ValidationError,
  assertOwner,
  decideCommit,
  COMMIT_MAX_AGE_MS,
  RECLAIM_MIN_AGE_MS,
  canReclaim,
  isTooOldToCommit,
  planCommit,
  parseReclaimBody,
  planReclaim,
  stateFileIdFor,
  grantsRead,
  parseCommitBody,
  parseCreateBody,
  parseRenameBody,
  toUploadMeta,
} from "./uploads";

describe("decideCommit", () => {
  const current = { version: 3, stateFileId: "old" };

  it("accepts a save based on the current version", () => {
    expect(decideCommit(current, 3, "new")).toEqual({ ok: true, nextVersion: 4, deleteFileId: "old" });
  });

  it("refuses a stale save and deletes the new file", () => {
    expect(decideCommit(current, 2, "new")).toEqual({ ok: false, deleteFileId: "new" });
  });

  it("refuses a save from a version ahead of the stored one", () => {
    expect(decideCommit(current, 4, "new")).toEqual({ ok: false, deleteFileId: "new" });
  });
});

describe("assertOwner", () => {
  it("passes for the owner", () => {
    expect(() => assertOwner({ ownerId: "u1" }, "u1")).not.toThrow();
  });

  it("throws NotFound for someone else", () => {
    expect(() => assertOwner({ ownerId: "u1" }, "u2")).toThrow(NotFound);
  });
});

describe("grantsRead", () => {
  it("is true when the user has read permission", () => {
    expect(grantsRead(['read("user:u1")', 'update("user:u1")'], "u1")).toBe(true);
  });

  it("is false for another user or a team grant", () => {
    expect(grantsRead(['read("user:u2")', 'read("team:members")'], "u1")).toBe(false);
  });
});

describe("parseCreateBody", () => {
  const good = { id: "abc123", name: "a.xlsx", originalFileId: "o1", stateFileId: "abc123.v1", rowCount: 10, sheetCount: 2 };

  it("accepts a valid body and ignores extra fields", () => {
    expect(parseCreateBody({ ...good, ownerId: "evil", version: 9 })).toEqual(good);
  });

  it.each([
    ["missing name", { ...good, name: "" }],
    ["long name", { ...good, name: "x".repeat(256) }],
    ["blank id", { ...good, originalFileId: "  " }],
    ["negative count", { ...good, rowCount: -1 }],
    ["fractional count", { ...good, sheetCount: 1.5 }],
    ["string count", { ...good, rowCount: "10" }],
    ["not an object", null],
    ["missing id", { ...good, id: undefined }],
    ["id starting with a special char", { ...good, id: "_abc", stateFileId: "_abc.v1" }],
    ["id with a bad char", { ...good, id: "ab/c", stateFileId: "ab/c.v1" }],
    ["id longer than 20", { ...good, id: "a".repeat(21), stateFileId: `${"a".repeat(21)}.v1` }],
    ["state file not named for version 1", { ...good, stateFileId: "abc123.v2" }],
    ["state file for another upload", { ...good, stateFileId: "other.v1" }],
  ])("rejects %s", (_label, body) => {
    expect(() => parseCreateBody(body)).toThrow(ValidationError);
  });

  it("accepts a 20-char id with . - _", () => {
    const id = "a1.b-c_d" + "x".repeat(12);
    expect(parseCreateBody({ ...good, id, stateFileId: `${id}.v1` }).id).toBe(id);
  });

  it("trims the name", () => {
    expect(parseCreateBody({ ...good, name: "  a.xlsx " }).name).toBe("a.xlsx");
  });
});

describe("parseRenameBody", () => {
  it("accepts a name up to 255 chars", () => {
    expect(parseRenameBody({ name: "x".repeat(255) })).toEqual({ name: "x".repeat(255) });
  });

  it("rejects empty or too long names", () => {
    expect(() => parseRenameBody({ name: "   " })).toThrow(ValidationError);
    expect(() => parseRenameBody({ name: "x".repeat(256) })).toThrow(ValidationError);
  });
});

describe("parseCommitBody", () => {
  it("accepts a state file id and base version", () => {
    expect(parseCommitBody({ stateFileId: "s2", baseVersion: 1 })).toEqual({ stateFileId: "s2", baseVersion: 1 });
  });

  it("rejects a missing base version", () => {
    expect(() => parseCommitBody({ stateFileId: "s2" })).toThrow(ValidationError);
  });
});

describe("toUploadMeta", () => {
  it("maps a row and drops ownerId", () => {
    const row = {
      $id: "r1",
      $createdAt: "2026-01-01",
      $updatedAt: "2026-01-02",
      ownerId: "u1",
      name: "a.xlsx",
      originalFileId: "o1",
      stateFileId: "s1",
      version: 2,
      rowCount: 5,
      sheetCount: 1,
    };
    expect(toUploadMeta(row)).toEqual({
      id: "r1",
      name: "a.xlsx",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      originalFileId: "o1",
      stateFileId: "s1",
      version: 2,
      rowCount: 5,
      sheetCount: 1,
    });
  });
});


describe("stateFileIdFor", () => {
  const APPWRITE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;

  it("names the state file after the upload and version", () => {
    expect(stateFileIdFor("abc", 1)).toBe("abc.v1");
    expect(stateFileIdFor("abc", 42)).toBe("abc.v42");
  });

  it("is a valid Appwrite file ID for a 20-char upload id and a large version", () => {
    const id = stateFileIdFor("a".repeat(20), 999_999_999);
    expect(id).toMatch(APPWRITE_ID);
    expect(id.length).toBeLessThanOrEqual(36);
  });
});

describe("planCommit", () => {
  const current = { version: 3, stateFileId: "up1.v3" };

  it("accepts the expected next file on the current version", () => {
    expect(planCommit(current, "up1", 3, "up1.v4")).toEqual({ ok: true, nextVersion: 4, deleteFileId: "up1.v3" });
  });

  it("rejects a file not named for baseVersion + 1 as a validation error", () => {
    expect(() => planCommit(current, "up1", 3, "up1.v5")).toThrow(ValidationError);
    expect(() => planCommit(current, "up1", 3, "other.v4")).toThrow(ValidationError);
    expect(() => planCommit(current, "up1", 3, "up1.v3")).toThrow(ValidationError);
  });

  it("refuses a stale base and deletes the new file", () => {
    // v2 was deleted when v3 was committed, so a tab still on v1 can recreate it.
    expect(planCommit(current, "up1", 1, "up1.v2")).toEqual({ ok: false, deleteFileId: "up1.v2" });
  });

  it("never deletes the live file when a stale save names it", () => {
    expect(() => planCommit({ version: 4, stateFileId: "up1.v4" }, "up1", 3, "up1.v4")).toThrow(ValidationError);
  });
});

describe("age thresholds", () => {
  const created = "2026-11-18T10:00:00.000Z";
  const t0 = Date.parse(created);

  it("keeps the commit window shorter than the reclaim age", () => {
    expect(COMMIT_MAX_AGE_MS).toBe(60_000);
    expect(RECLAIM_MIN_AGE_MS).toBe(120_000);
  });

  it("isTooOldToCommit: allowed up to and at the limit, refused after", () => {
    expect(isTooOldToCommit(created, t0)).toBe(false);
    expect(isTooOldToCommit(created, t0 + COMMIT_MAX_AGE_MS)).toBe(false);
    expect(isTooOldToCommit(created, t0 + COMMIT_MAX_AGE_MS + 1)).toBe(true);
  });

  it("canReclaim: refused below the age, allowed at and after it", () => {
    expect(canReclaim(created, t0 + RECLAIM_MIN_AGE_MS - 1)).toBe(false);
    expect(canReclaim(created, t0 + RECLAIM_MIN_AGE_MS)).toBe(true);
    expect(canReclaim(created, t0 + RECLAIM_MIN_AGE_MS + 1)).toBe(true);
  });

  it("a reclaimable file is never committable", () => {
    for (const age of [0, COMMIT_MAX_AGE_MS, COMMIT_MAX_AGE_MS + 1, RECLAIM_MIN_AGE_MS - 1, RECLAIM_MIN_AGE_MS, 10 * RECLAIM_MIN_AGE_MS]) {
      if (canReclaim(created, t0 + age)) expect(isTooOldToCommit(created, t0 + age)).toBe(true);
    }
  });

  it("treats an unparseable timestamp as too old to commit and reclaimable", () => {
    expect(isTooOldToCommit("garbage", t0)).toBe(true);
    expect(canReclaim("garbage", t0)).toBe(true);
  });
});

describe("planReclaim", () => {
  it("targets the next version's state file when the base matches", () => {
    expect(planReclaim({ version: 3 }, "up1", 3)).toEqual({ ok: true, fileId: "up1.v4" });
  });

  it("is a conflict when the stored version moved", () => {
    expect(planReclaim({ version: 4 }, "up1", 3)).toEqual({ ok: false });
    expect(planReclaim({ version: 2 }, "up1", 3)).toEqual({ ok: false });
  });
});

describe("parseReclaimBody", () => {
  it("accepts a base version and rejects anything else", () => {
    expect(parseReclaimBody({ baseVersion: 2 })).toEqual({ baseVersion: 2 });
    expect(() => parseReclaimBody({ baseVersion: -1 })).toThrow(ValidationError);
    expect(() => parseReclaimBody({})).toThrow(ValidationError);
  });
});
