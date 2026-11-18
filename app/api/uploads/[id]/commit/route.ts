import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import {
  CONFLICT_MESSAGE,
  STALE_MESSAGE,
  ValidationError,
  isTooOldToCommit,
  lastWriteOf,
  parseCommitBody,
  planCommit,
  type CommitRefusal,
} from "@/lib/uploads";
import { claimFile, deleteFileQuietly, getOwnedRow, handle, readJson } from "@/lib/uploads-server";

const refuse = (code: CommitRefusal) =>
  Response.json({ error: code === "stale" ? STALE_MESSAGE : CONFLICT_MESSAGE, code }, { status: 409 });

/**
 * Swap in a new state file if the save started from the stored version.
 *
 * Gate: the browser must create the new state file with id stateFileIdFor(id, baseVersion + 1).
 * Storage file ids are unique per bucket, so two saves from the same base cannot both create that
 * file — the second gets 409 at createFile and never reaches this route. (State files are kept
 * below the SDK's chunk size, so createFile is always a single request that fails on a taken id
 * instead of resuming a chunked upload.) A save from an older base fails the
 * `row.version === baseVersion` check below (version only ever goes up). So no save can silently
 * overwrite another, without relying on transactions.
 *
 * `size` must match the stored file's size; otherwise 400 and nothing is deleted.
 *
 * A file last written more than COMMIT_MAX_AGE_MS ago is refused with code "stale" (and deleted,
 * so the browser can create it again): after RECLAIM_MIN_AGE_MS the reclaim route may delete it
 * as an orphan, and the commit window ending first means it can never be both.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/uploads/[id]/commit">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { stateFileId, baseVersion, size } = parseCommitBody(await readJson(request));
    const { tables, storage } = createAdminClient();

    const row = await getOwnedRow(tables, id, user.id);
    const plan = planCommit(row, id, baseVersion, stateFileId); // 400 before touching any file
    const file = await claimFile(storage, IDS.states, stateFileId, user.id);
    if (file.sizeOriginal !== size) throw new ValidationError("The uploaded state file is incomplete or different.");

    if (!plan.ok) {
      await deleteFileQuietly(storage, IDS.states, stateFileId, user.id);
      return refuse("conflict");
    }
    if (isTooOldToCommit(lastWriteOf(file), Date.now())) {
      await deleteFileQuietly(storage, IDS.states, stateFileId, user.id);
      return refuse("stale");
    }

    await tables.updateRow({
      databaseId: IDS.database,
      tableId: IDS.uploads,
      rowId: id,
      data: { stateFileId, version: plan.nextVersion },
    });
    await deleteFileQuietly(storage, IDS.states, plan.deleteFileId, user.id);
    return Response.json({ version: plan.nextVersion });
  });
}
