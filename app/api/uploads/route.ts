import { AppwriteException } from "node-appwrite";
import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import { parseCreateBody, toUploadMeta } from "@/lib/uploads";
import { claimFile, handle, listUploadsFor, readJson, type UploadRow } from "@/lib/uploads-server";

/** The caller's uploads, newest first. */
export async function GET() {
  return handle(async () => {
    const user = await requireMember();
    const { tables } = createAdminClient();
    return Response.json(await listUploadsFor(tables, user.id), { headers: { "Cache-Control": "no-store" } });
  });
}

/**
 * Registers an upload whose files the browser already put in Storage. The browser picks the row
 * id (ID.unique()) so the first state file can be named stateFileIdFor(id, 1).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireMember();
    const body = parseCreateBody(await readJson(request));
    const { tables, storage } = createAdminClient();

    await claimFile(storage, IDS.originals, body.originalFileId, user.id);
    await claimFile(storage, IDS.states, body.stateFileId, user.id);

    const { id, ...data } = body;
    let row: UploadRow;
    try {
      row = await tables.createRow<UploadRow>({
        databaseId: IDS.database,
        tableId: IDS.uploads,
        rowId: id,
        data: { ...data, ownerId: user.id, version: 1 },
        permissions: [], // no client access: only the server (API key) reads or writes rows
      });
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 409) {
        return Response.json({ error: "An upload with this id already exists." }, { status: 409 });
      }
      throw e;
    }
    return Response.json(toUploadMeta(row), { status: 201 });
  });
}
