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

export function parseCommitBody(body: unknown): { stateFileId: string; baseVersion: number } {
  const o = asObject(body);
  return { stateFileId: str(o, "stateFileId"), baseVersion: count(o, "baseVersion") };
}
