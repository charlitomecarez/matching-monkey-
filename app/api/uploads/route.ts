import { AppwriteException, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import { parseCreateBody, toUploadMeta, type UploadMeta } from "@/lib/uploads";
import { claimFile, handle, ownerPermissions, readJson, type UploadRow } from "@/lib/uploads-server";

const PAGE = 100;

/** The caller's uploads, newest first. */
export async function GET() {
  return handle(async () => {
    const user = await requireMember();
    const { tables } = createAdminClient();
    const out: UploadMeta[] = [];
    let cursor: string | undefined;
    for (;;) {
      const queries = [Query.equal("ownerId", user.id), Query.orderDesc("$createdAt"), Query.limit(PAGE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const { rows } = await tables.listRows<UploadRow>({ databaseId: IDS.database, tableId: IDS.uploads, queries });
      out.push(...rows.map(toUploadMeta));
      if (rows.length < PAGE) return Response.json(out);
      cursor = rows[rows.length - 1].$id;
    }
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
        permissions: ownerPermissions(user.id),
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
