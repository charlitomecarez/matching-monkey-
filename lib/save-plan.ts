// Pure decision logic for one save attempt (see lib/upload-client.ts saveState).
//
// A save from version V creates the state file stateFileIdFor(id, V + 1), then commits it. The
// create is the gate: a taken id means another save (or an orphan) got there first, so reclaim is
// tried once. A commit whose response is lost is checked against the server before anything else.
// A commit refused as too slow ("stale") starts over once; a second one is reported as an error.
import { CONFLICT_MESSAGE, COMMIT_MAX_AGE_MS } from "./uploads";

/** Wait before retrying when another save from the same version is still in progress. */
export const SAVE_BUSY_RETRY_MS = 30_000;
/** Retry a failed commit with the same file only while it is safely younger than COMMIT_MAX_AGE_MS. */
export const COMMIT_RETRY_WINDOW_MS = COMMIT_MAX_AGE_MS - 15_000;

export type SaveOutcome =
  | { step: "create"; result: "ok" | "exists" | "error"; retried: boolean }
  /** cleared = reclaim answered { reclaimed: true | false } */
  | { step: "reclaim"; result: "cleared" | "busy" | "conflict" | "error" }
  | { step: "commit"; result: "ok"; version: number }
  | { step: "commit"; result: "conflict" | "error" }
  /** stale = the commit was refused as too slow (the server deleted the file); retried = seen before */
  | { step: "commit"; result: "stale"; retried: boolean }
  /** committed = the server's current state file is the one this save created */
  | { step: "verify"; result: "committed"; version: number }
  | { step: "verify"; result: "not-committed"; sinceCreateMs: number }
  | { step: "verify"; result: "moved" | "error" };

export type SaveStep =
  | { kind: "create"; retried: boolean }
  | { kind: "reclaim" }
  | { kind: "commit" }
  | { kind: "verify" }
  | { kind: "done"; version: number }
  | { kind: "conflict"; message: string }
  /** Give up this attempt for now; start a fresh one after `ms`, keeping the edits. */
  | { kind: "wait"; ms: number }
  /** Network / server error: retry with backoff, keeping the edits. */
  | { kind: "error" };

const conflict: SaveStep = { kind: "conflict", message: CONFLICT_MESSAGE };

export function nextSaveStep(o: SaveOutcome): SaveStep {
  switch (o.step) {
    case "create":
      if (o.result === "ok") return { kind: "commit" };
      if (o.result === "exists") return o.retried ? conflict : { kind: "reclaim" };
      return { kind: "error" };
    case "reclaim":
      if (o.result === "cleared") return { kind: "create", retried: true };
      if (o.result === "busy") return { kind: "wait", ms: SAVE_BUSY_RETRY_MS };
      if (o.result === "conflict") return conflict;
      return { kind: "error" };
    case "commit":
      if (o.result === "ok") return { kind: "done", version: o.version };
      if (o.result === "conflict") return conflict;
      // Too slow is never a conflict: the server deleted the file, so create it again once.
      if (o.result === "stale") return o.retried ? { kind: "error" } : { kind: "create", retried: false };
      return { kind: "verify" };
    case "verify":
      if (o.result === "committed") return { kind: "done", version: o.version };
      if (o.result === "not-committed") {
        return o.sinceCreateMs < COMMIT_RETRY_WINDOW_MS ? { kind: "commit" } : { kind: "create", retried: false };
      }
      if (o.result === "moved") return conflict;
      return { kind: "error" };
  }
}

/** Backoff for retrying after an error: 2 s, 4 s, 8 s, 16 s, then 30 s. attempt starts at 1. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}
