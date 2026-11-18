import { describe, expect, it } from "vitest";
import {
  NotFound,
  ValidationError,
  assertOwner,
  decideCommit,
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
  const good = { name: "a.xlsx", originalFileId: "o1", stateFileId: "s1", rowCount: 10, sheetCount: 2 };

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
  ])("rejects %s", (_label, body) => {
    expect(() => parseCreateBody(body)).toThrow(ValidationError);
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
