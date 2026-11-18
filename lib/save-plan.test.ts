import { describe, expect, it } from "vitest";
import { COMMIT_RETRY_WINDOW_MS, SAVE_BUSY_RETRY_MS, nextSaveStep, retryDelayMs } from "./save-plan";
import { CONFLICT_MESSAGE } from "./uploads";

const conflict = { kind: "conflict", message: CONFLICT_MESSAGE };

describe("nextSaveStep", () => {
  it("commits right after the state file is created", () => {
    expect(nextSaveStep({ step: "create", result: "ok", retried: false })).toEqual({ kind: "commit" });
    expect(nextSaveStep({ step: "create", result: "ok", retried: true })).toEqual({ kind: "commit" });
  });

  it("reclaims once when the file id is taken", () => {
    expect(nextSaveStep({ step: "create", result: "exists", retried: false })).toEqual({ kind: "reclaim" });
  });

  it("is a conflict when the retried create is taken again", () => {
    expect(nextSaveStep({ step: "create", result: "exists", retried: true })).toEqual(conflict);
  });

  it("retries create once after reclaim, whether or not a file was deleted", () => {
    expect(nextSaveStep({ step: "reclaim", result: "cleared" })).toEqual({ kind: "create", retried: true });
  });

  it("backs off when another save is still in progress", () => {
    expect(nextSaveStep({ step: "reclaim", result: "busy" })).toEqual({ kind: "wait", ms: SAVE_BUSY_RETRY_MS });
  });

  it("is a conflict when reclaim reports the version moved", () => {
    expect(nextSaveStep({ step: "reclaim", result: "conflict" })).toEqual(conflict);
  });

  it("finishes with the committed version", () => {
    expect(nextSaveStep({ step: "commit", result: "ok", version: 4 })).toEqual({ kind: "done", version: 4 });
  });

  it("is a conflict when the commit is refused", () => {
    expect(nextSaveStep({ step: "commit", result: "conflict" })).toEqual(conflict);
  });

  it("checks the server after a commit that failed in transit", () => {
    expect(nextSaveStep({ step: "commit", result: "error" })).toEqual({ kind: "verify" });
  });

  it("treats the save as done when the server already has this file", () => {
    expect(nextSaveStep({ step: "verify", result: "committed", version: 3 })).toEqual({ kind: "done", version: 3 });
  });

  it("retries the commit while the file is young, otherwise starts over", () => {
    expect(nextSaveStep({ step: "verify", result: "not-committed", sinceCreateMs: 1_000 })).toEqual({ kind: "commit" });
    expect(
      nextSaveStep({ step: "verify", result: "not-committed", sinceCreateMs: COMMIT_RETRY_WINDOW_MS }),
    ).toEqual({ kind: "create", retried: false });
  });

  it("is a conflict when someone else moved the version", () => {
    expect(nextSaveStep({ step: "verify", result: "moved" })).toEqual(conflict);
  });

  it("reports network errors for a retry with backoff", () => {
    expect(nextSaveStep({ step: "create", result: "error", retried: false })).toEqual({ kind: "error" });
    expect(nextSaveStep({ step: "reclaim", result: "error" })).toEqual({ kind: "error" });
    expect(nextSaveStep({ step: "verify", result: "error" })).toEqual({ kind: "error" });
  });
});

describe("retryDelayMs", () => {
  it("doubles from 2 s and caps at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});
