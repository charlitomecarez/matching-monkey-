import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppwriteException, Permission, Role, type Models, type Storage, type TablesDB } from "node-appwrite";
import { IDS } from "./appwrite/config";
import { AuthError } from "./auth";
import { NotFound, ValidationError, assertOwner, grantsRead } from "./uploads";

export type UploadRow = Models.Row & {
  ownerId: string;
  name: string;
  originalFileId: string;
  stateFileId: string;
  version: number;
  rowCount: number;
  sheetCount: number;
};

/** Read/update/delete for the owner only. */
export function ownerPermissions(userId: string): string[] {
  const role = Role.user(userId);
  return [Permission.read(role), Permission.update(role), Permission.delete(role)];
}

const isNotFound = (e: unknown): boolean => e instanceof AppwriteException && e.code === 404;

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
 * user's file ID), then pins its permissions to the caller alone.
 */
export async function claimFile(storage: Storage, bucketId: string, fileId: string, userId: string): Promise<void> {
  let file: Models.File;
  try {
    file = await storage.getFile({ bucketId, fileId });
  } catch (e) {
    if (isNotFound(e)) throw new ValidationError("File not found.");
    throw e;
  }
  if (!grantsRead(file.$permissions, userId)) throw new ValidationError("File not found.");
  await storage.updateFile({ bucketId, fileId, permissions: ownerPermissions(userId) });
}

/**
 * Best-effort cleanup after the row change has already happened: "already gone" is success,
 * other failures are logged (an orphaned file) rather than failing the request.
 */
export async function deleteFileQuietly(storage: Storage, bucketId: string, fileId: string): Promise<void> {
  try {
    await storage.deleteFile({ bucketId, fileId });
  } catch (e) {
    if (!isNotFound(e)) console.error(`Could not delete ${bucketId}/${fileId}`, e);
  }
}
