import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import { parseRenameBody, toUploadMeta } from "@/lib/uploads";
import { deleteFileQuietly, getOwnedRow, handle, readJson, type UploadRow } from "@/lib/uploads-server";

/** The current metadata of one of the caller's uploads (fresh, never cached). */
export async function GET(_request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const row = await getOwnedRow(createAdminClient().tables, id, user.id);
    return Response.json(toUploadMeta(row), { headers: { "Cache-Control": "no-store" } });
  });
}

/** Rename an upload. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { name } = parseRenameBody(await readJson(request));
    const { tables } = createAdminClient();
    await getOwnedRow(tables, id, user.id);
    const row = await tables.updateRow<UploadRow>({
      databaseId: IDS.database,
      tableId: IDS.uploads,
      rowId: id,
      data: { name },
    });
    return Response.json(toUploadMeta(row));
  });
}

/** Delete an upload and both of its files. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { tables, storage } = createAdminClient();
    const row = await getOwnedRow(tables, id, user.id);
    await tables.deleteRow({ databaseId: IDS.database, tableId: IDS.uploads, rowId: id });
    await deleteFileQuietly(storage, IDS.originals, row.originalFileId, user.id);
    await deleteFileQuietly(storage, IDS.states, row.stateFileId, user.id);
    return new Response(null, { status: 204 });
  });
}
