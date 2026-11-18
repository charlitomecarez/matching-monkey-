import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import {
  CONFLICT_MESSAGE,
  NotFound,
  ValidationError,
  committedCleanly,
  decideCommit,
  isConflictError,
  parseCommitBody,
  stagedVersionOk,
} from "@/lib/uploads";
import {
  claimFile,
  deleteFileQuietly,
  getOwnedRow,
  handle,
  isNotFound,
  readJson,
  type UploadRow,
} from "@/lib/uploads-server";

class Stale extends Error {}

const conflict = () => Response.json({ error: CONFLICT_MESSAGE }, { status: 409 });

/**
 * Swap in a new state file only if the save started from the stored version.
 * The gate is atomic: inside one transaction, `version` is incremented with max = baseVersion + 1
 * (Appwrite refuses the increment if another save already bumped it) and the state pointer is
 * updated, so the version and the pointer never diverge and no save silently overwrites another.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/uploads/[id]/commit">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { stateFileId, baseVersion } = parseCommitBody(await readJson(request));
    const { tables, storage } = createAdminClient();
    const where = { databaseId: IDS.database, tableId: IDS.uploads, rowId: id };

    const row = await getOwnedRow(tables, id, user.id);
    // Re-sending the current file would make a conflict delete the live state.
    if (stateFileId === row.stateFileId) throw new ValidationError("stateFileId is already the current state.");
    await claimFile(storage, IDS.states, stateFileId, user.id);

    // Fast pre-check; the transaction below is the real gate.
    const decision = decideCommit(row, baseVersion, stateFileId);
    if (!decision.ok) {
      await deleteFileQuietly(storage, IDS.states, decision.deleteFileId);
      return conflict();
    }

    const { $id: transactionId } = await tables.createTransaction({ ttl: 60 });
    try {
      const staged = await tables.incrementRowColumn<UploadRow>({
        ...where,
        column: "version",
        value: 1,
        max: baseVersion + 1,
        transactionId,
      });
      if (!stagedVersionOk(staged.version, baseVersion)) throw new Stale();
      await tables.updateRow({ ...where, data: { stateFileId }, transactionId });
      await tables.updateTransaction({ transactionId, commit: true });
    } catch (e) {
      await tables.updateTransaction({ transactionId, rollback: true }).catch(() => {});
      if (e instanceof Stale || isConflictError(e)) {
        await deleteFileQuietly(storage, IDS.states, stateFileId);
        return conflict();
      }
      if (isNotFound(e)) {
        // The upload was deleted meanwhile.
        await deleteFileQuietly(storage, IDS.states, stateFileId);
        throw new NotFound();
      }
      // Unknown outcome: keep the new file (an orphan is safer than deleting live state).
      throw e;
    }

    // Belt and braces: confirm the row holds exactly our bump before deleting the old file.
    const after = await tables.getRow<UploadRow>(where);
    if (!committedCleanly(after, baseVersion, stateFileId)) {
      console.error("Commit landed but row is not in the expected state", {
        id,
        baseVersion,
        stateFileId,
        version: after.version,
        storedStateFileId: after.stateFileId,
      });
      return conflict();
    }

    await deleteFileQuietly(storage, IDS.states, decision.deleteFileId);
    return Response.json({ version: after.version });
  });
}
