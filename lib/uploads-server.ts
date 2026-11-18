import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppwriteException, Permission, Query, Role, type Models, type Storage, type TablesDB } from "node-appwrite";
import { IDS } from "./appwrite/config";
import { AuthError } from "./auth";
import { NotFound, ValidationError, assertOwner, grantsRead, toUploadMeta, type UploadMeta } from "./uploads";

export type UploadRow = Models.Row & {
  ownerId: string;
  name: string;
  originalFileId: string;
  stateFileId: string;
  version: number;
  rowCount: number;
  sheetCount: number;
};

/**
 * File permissions: read/update/delete for the owner only. Rows get no permissions at all: the
 * browser never touches the table; the server reads and writes it with the API key after
 * requireMember() and an owner check.
 */
export function ownerPermissions(userId: string): string[] {
  const role = Role.user(userId);
  return [Permission.read(role), Permission.update(role), Permission.delete(role)];
}

export const isNotFound = (e: unknown): boolean => e instanceof AppwriteException && e.code === 404;

/** Runs a route body and maps known errors to JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e); // let Next handle its own control-flow errors (e.g. prerender bailout on cookies())
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof NotFound) return Response.json({ error: e.message }, { status: 404 });
    if (e instanceof ValidationError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Expected a JSON body.");
  }
}

const LIST_PAGE = 100;

/** All of a user's uploads, newest first. */
export async function listUploadsFor(tables: TablesDB, userId: string): Promise<UploadMeta[]> {
  const out: UploadMeta[] = [];
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.equal("ownerId", userId), Query.orderDesc("$createdAt"), Query.limit(LIST_PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const { rows } = await tables.listRows<UploadRow>({ databaseId: IDS.database, tableId: IDS.uploads, queries });
    out.push(...rows.map(toUploadMeta));
    if (rows.length < LIST_PAGE) return out;
    cursor = rows[rows.length - 1].$id;
  }
}

/** The upload row if it exists and belongs to userId; otherwise NotFound. */
export async function getOwnedRow(tables: TablesDB, rowId: string, userId: string): Promise<UploadRow> {
  let row: UploadRow;
  try {
    row = await tables.getRow<UploadRow>({ databaseId: IDS.database, tableId: IDS.uploads, rowId });
  } catch (e) {
    if (isNotFound(e)) throw new NotFound();
    throw e;
  }
  assertOwner(row, userId);
  return row;
}

/**
 * Checks the file exists and the caller can already read it (so nobody can claim another
 * user's file ID), then pins its permissions to the caller alone. Returns the file as it was
 * before that update, so its timestamps still describe the upload (updateFile bumps $updatedAt).
 */
export async function claimFile(
  storage: Storage,
  bucketId: string,
  fileId: string,
  userId: string,
): Promise<Models.File> {
  let file: Models.File;
  try {
    file = await storage.getFile({ bucketId, fileId });
  } catch (e) {
    if (isNotFound(e)) throw new ValidationError("File not found.");
    throw e;
  }
  if (!grantsRead(file.$permissions, userId)) throw new ValidationError("File not found.");
  await storage.updateFile({ bucketId, fileId, permissions: ownerPermissions(userId) });
  return file;
}

/**
 * Deletes a file with the API key only if it belongs to `ownerId` (grants them read directly).
 * Defence in depth: a file id that came from a row must not let the server delete someone
 * else's file. A missing file counts as deleted; a foreign file is skipped and logged.
 * Returns true when the file is gone afterwards.
 */
export async function deleteOwnedFile(
  storage: Storage,
  bucketId: string,
  fileId: string,
  ownerId: string,
): Promise<boolean> {
  let file: Models.File;
  try {
    file = await storage.getFile({ bucketId, fileId });
  } catch (e) {
    if (isNotFound(e)) return true;
    throw e;
  }
  if (!grantsRead(file.$permissions, ownerId)) {
    console.warn(`Not deleting ${bucketId}/${fileId}: it does not belong to user ${ownerId}.`);
    return false;
  }
  try {
    await storage.deleteFile({ bucketId, fileId });
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  return true;
}

/**
 * Best-effort cleanup after the row change has already happened: only the owner's file is
 * deleted (see deleteOwnedFile), "already gone" is success, and other failures are logged (an
 * orphaned file) rather than failing the request.
 */
export async function deleteFileQuietly(
  storage: Storage,
  bucketId: string,
  fileId: string,
  ownerId: string,
): Promise<void> {
  try {
    await deleteOwnedFile(storage, bucketId, fileId, ownerId);
  } catch (e) {
    console.error(`Could not delete ${bucketId}/${fileId}`, e);
  }
}
