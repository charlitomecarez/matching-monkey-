import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import { CONFLICT_MESSAGE, isTooOldToCommit, parseCommitBody, planCommit } from "@/lib/uploads";
import { claimFile, deleteFileQuietly, getOwnedRow, handle, readJson } from "@/lib/uploads-server";

/**
 * Swap in a new state file if the save started from the stored version.
 *
 * Gate: the browser must create the new state file with id stateFileIdFor(id, baseVersion + 1).
 * Storage file ids are unique per bucket, so two saves from the same base cannot both create that
 * file — the second gets 409 at createFile and never reaches this route. A save from an older base
 * fails the `row.version === baseVersion` check below (version only ever goes up). So no save can
 * silently overwrite another, without relying on transactions.
 *
 * A file older than COMMIT_MAX_AGE_MS is refused: after RECLAIM_MIN_AGE_MS the reclaim route may
 * delete it as an orphan, and the commit window ending first means it can never be both.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/uploads/[id]/commit">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { stateFileId, baseVersion } = parseCommitBody(await readJson(request));
    const { tables, storage } = createAdminClient();

    const row = await getOwnedRow(tables, id, user.id);
    const plan = planCommit(row, id, baseVersion, stateFileId); // 400 before touching any file
    const file = await claimFile(storage, IDS.states, stateFileId, user.id);

    if (!plan.ok || isTooOldToCommit(file.$createdAt, Date.now())) {
      await deleteFileQuietly(storage, IDS.states, stateFileId);
      return Response.json({ error: CONFLICT_MESSAGE }, { status: 409 });
    }

    await tables.updateRow({
      databaseId: IDS.database,
      tableId: IDS.uploads,
      rowId: id,
      data: { stateFileId, version: plan.nextVersion },
    });
    await deleteFileQuietly(storage, IDS.states, plan.deleteFileId);
    return Response.json({ version: plan.nextVersion });
  });
}
