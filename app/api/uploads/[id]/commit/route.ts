import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import { CONFLICT_MESSAGE, ValidationError, decideCommit, parseCommitBody } from "@/lib/uploads";
import { claimFile, deleteFileQuietly, getOwnedRow, handle, readJson } from "@/lib/uploads-server";

/** Swap in a new state file if the save started from the stored version. */
export async function POST(request: Request, ctx: RouteContext<"/api/uploads/[id]/commit">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { stateFileId, baseVersion } = parseCommitBody(await readJson(request));
    const { tables, storage } = createAdminClient();

    const row = await getOwnedRow(tables, id, user.id);
    // Re-sending the current file would make a conflict delete the live state.
    if (stateFileId === row.stateFileId) throw new ValidationError("stateFileId is already the current state.");
    await claimFile(storage, IDS.states, stateFileId, user.id);

    const decision = decideCommit(row, baseVersion, stateFileId);
    if (!decision.ok) {
      await deleteFileQuietly(storage, IDS.states, decision.deleteFileId);
      return Response.json({ error: CONFLICT_MESSAGE }, { status: 409 });
    }

    await tables.updateRow({
      databaseId: IDS.database,
      tableId: IDS.uploads,
      rowId: id,
      data: { stateFileId, version: decision.nextVersion },
    });
    await deleteFileQuietly(storage, IDS.states, decision.deleteFileId);
    return Response.json({ version: decision.nextVersion });
  });
}
