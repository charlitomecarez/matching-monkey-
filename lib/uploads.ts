/** Pure upload helpers shared by the uploads API and the browser. No server or SDK imports. */

export type UploadMeta = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  originalFileId: string;
  stateFileId: string;
  version: number;
  rowCount: number;
  sheetCount: number;
};

export const CONFLICT_MESSAGE = "This upload was changed in another tab or device — reload to continue.";
/** 409 body when a commit is refused because the file is older than COMMIT_MAX_AGE_MS. */
export const STALE_MESSAGE = "Save took too long — retrying.";

/** `code` in a commit route's 409 body: a real conflict, or a save that took too long. */
export type CommitRefusal = "conflict" | "stale";
export const MAX_NAME = 255;

/** The resource doesn't exist or belongs to someone else (never reveal which). */
export class NotFound extends Error {
  constructor(message = "Upload not found.") {
    super(message);
    this.name = "NotFound";
  }
}

/** Bad request body; the message is safe to show. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function assertOwner(row: { ownerId: string }, userId: string): void {
  if (row.ownerId !== userId) throw new NotFound();
}

export function decideCommit(
  current: { version: number; stateFileId: string },
  baseVersion: number,
  newStateFileId: string,
): { ok: true; nextVersion: number; deleteFileId: string } | { ok: false; deleteFileId: string } {
  if (baseVersion === current.version) {
    return { ok: true, nextVersion: current.version + 1, deleteFileId: current.stateFileId };
  }
  return { ok: false, deleteFileId: newStateFileId };
}

/** Client-generated upload/row id (ID.unique() is 20 chars); leaves room for the ".v<n>" suffix. */
export const UPLOAD_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,19}$/;

/**
 * Storage file id of an upload's state at a given version. File ids are unique per bucket, so
 * only one save can create the file for version n + 1 — that uniqueness is the commit gate.
 */
export function stateFileIdFor(uploadId: string, version: number): string {
  return `${uploadId}.v${version}`;
}

/**
 * Pre-checks for a commit. Throws ValidationError (nothing is deleted) when the new file is not
 * named for baseVersion + 1 or is already the live state file; otherwise the version decision.
 */
export function planCommit(
  current: { version: number; stateFileId: string },
  uploadId: string,
  baseVersion: number,
  newStateFileId: string,
): ReturnType<typeof decideCommit> {
  if (newStateFileId !== stateFileIdFor(uploadId, baseVersion + 1)) {
    throw new ValidationError("stateFileId must be named for baseVersion + 1.");
  }
  if (newStateFileId === current.stateFileId) throw new ValidationError("stateFileId is already the current state.");
  return decideCommit(current, baseVersion, newStateFileId);
}

/**
 * Orphan recovery. A tab can die between creating `<id>.v(N+1)` and committing it; that file would
 * block every later save from version N. The reclaim route may delete such a file once it is at
 * least RECLAIM_MIN_AGE_MS old, and the commit route refuses any file older than COMMIT_MAX_AGE_MS.
 * Because COMMIT_MAX_AGE_MS < RECLAIM_MIN_AGE_MS (both measured against the same clocks), a file
 * old enough to be reclaimed can never still be committed, so reclaiming never discards a save
 * that is about to succeed. The gap also absorbs a slow commit request.
 *
 * Ages are measured from the file's last write (lastWriteOf), not its creation: a chunked upload
 * creates the file with its first chunk, and a slow upload must not look old the moment it ends.
 */
export const COMMIT_MAX_AGE_MS = 60_000;
export const RECLAIM_MIN_AGE_MS = 120_000;
export const SAVE_IN_PROGRESS_MESSAGE = "Another save is still in progress — try again in a moment.";

function ageMs(writtenAt: string, now: number): number {
  const t = Date.parse(writtenAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : now - t;
}

/** When a Storage file was last written: $updatedAt, or $createdAt if that is missing. */
export function lastWriteOf(file: { $createdAt: string; $updatedAt?: string }): string {
  return file.$updatedAt || file.$createdAt;
}

/** The new state file was written too long ago to be committed (unparseable = too old). */
export function isTooOldToCommit(writtenAt: string, now: number): boolean {
  return ageMs(writtenAt, now) > COMMIT_MAX_AGE_MS;
}

/** The pending state file is old enough to be treated as an orphan and deleted. */
export function canReclaim(writtenAt: string, now: number): boolean {
  return ageMs(writtenAt, now) >= RECLAIM_MIN_AGE_MS;
}

/** Which file a reclaim from baseVersion may clear; a moved version is a conflict. */
export function planReclaim(
  current: { version: number },
  uploadId: string,
  baseVersion: number,
): { ok: true; fileId: string } | { ok: false } {
  if (current.version !== baseVersion) return { ok: false };
  return { ok: true, fileId: stateFileIdFor(uploadId, current.version + 1) };
}

export function parseReclaimBody(body: unknown): { baseVersion: number } {
  return { baseVersion: count(asObject(body), "baseVersion") };
}

/** True when an Appwrite permission list grants the user read access directly. */
export function grantsRead(permissions: string[], userId: string): boolean {
  return permissions.includes(`read("user:${userId}")`);
}

type UploadRow = {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  name: string;
  originalFileId: string;
  stateFileId: string;
  version: number;
  rowCount: number;
  sheetCount: number;
};

export function toUploadMeta(row: UploadRow): UploadMeta {
  return {
    id: row.$id,
    name: row.name,
    createdAt: row.$createdAt,
    updatedAt: row.$updatedAt,
    originalFileId: row.originalFileId,
    stateFileId: row.stateFileId,
    version: row.version,
    rowCount: row.rowCount,
    sheetCount: row.sheetCount,
  };
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Expected a JSON object.");
  }
  return body as Record<string, unknown>;
}

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.trim() === "") throw new ValidationError(`${key} is required.`);
  return v.trim();
}

function count(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new ValidationError(`${key} must be a whole number of 0 or more.`);
  }
  return v;
}

function name(o: Record<string, unknown>): string {
  const n = str(o, "name");
  if (n.length > MAX_NAME) throw new ValidationError(`name must be at most ${MAX_NAME} characters.`);
  return n;
}

export type CreateUploadBody = {
  id: string;
  name: string;
  originalFileId: string;
  stateFileId: string;
  rowCount: number;
  sheetCount: number;
};

export function parseCreateBody(body: unknown): CreateUploadBody {
  const o = asObject(body);
  const id = o.id;
  if (typeof id !== "string" || !UPLOAD_ID_RE.test(id)) {
    throw new ValidationError("id must be 1-20 characters of a-z, A-Z, 0-9, . - _ and start with a letter or digit.");
  }
  const stateFileId = str(o, "stateFileId");
  if (stateFileId !== stateFileIdFor(id, 1)) throw new ValidationError("stateFileId must be named for version 1.");
  return {
    id,
    name: name(o),
    originalFileId: str(o, "originalFileId"),
    stateFileId,
    rowCount: count(o, "rowCount"),
    sheetCount: count(o, "sheetCount"),
  };
}

export function parseRenameBody(body: unknown): { name: string } {
  return { name: name(asObject(body)) };
}

/** `size` is the byte size of the state file the browser uploaded (checked against Storage). */
export function parseCommitBody(body: unknown): { stateFileId: string; baseVersion: number; size: number } {
  const o = asObject(body);
  return { stateFileId: str(o, "stateFileId"), baseVersion: count(o, "baseVersion"), size: count(o, "size") };
}
