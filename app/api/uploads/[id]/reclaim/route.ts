import type { Models } from "node-appwrite";
import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import {
  CONFLICT_MESSAGE,
  SAVE_IN_PROGRESS_MESSAGE,
  canReclaim,
  grantsRead,
  lastWriteOf,
  parseReclaimBody,
  planReclaim,
} from "@/lib/uploads";
import { getOwnedRow, handle, isNotFound, readJson } from "@/lib/uploads-server";

/**
 * Clears an orphaned `<id>.v(N+1)` state file (a tab that died between createFile and commit) so
 * saves from version N can continue. Only files last written at least RECLAIM_MIN_AGE_MS ago are
 * deleted; the commit route refuses files older than COMMIT_MAX_AGE_MS, so a reclaimed file can
 * never be one that still gets committed. Only the caller's own file is deleted: a file in this
 * namespace owned by someone else is left alone (logged) and the save then reports a conflict.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/uploads/[id]/reclaim">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { baseVersion } = parseReclaimBody(await readJson(request));
    const { tables, storage } = createAdminClient();

    const row = await getOwnedRow(tables, id, user.id);
    const plan = planReclaim(row, id, baseVersion);
    if (!plan.ok) return Response.json({ error: CONFLICT_MESSAGE, code: "conflict" }, { status: 409 });

    let file: Models.File;
    try {
      file = await storage.getFile({ bucketId: IDS.states, fileId: plan.fileId });
    } catch (e) {
      if (isNotFound(e)) return Response.json({ reclaimed: false });
      throw e;
    }
    if (!grantsRead(file.$permissions, row.ownerId)) {
      console.warn(`Not reclaiming ${IDS.states}/${plan.fileId}: it does not belong to user ${row.ownerId}.`);
      return Response.json({ reclaimed: false });
    }
    if (!canReclaim(lastWriteOf(file), Date.now())) {
      return Response.json({ error: SAVE_IN_PROGRESS_MESSAGE }, { status: 409 });
    }

    try {
      await storage.deleteFile({ bucketId: IDS.states, fileId: plan.fileId });
    } catch (e) {
      if (!isNotFound(e)) throw e; // Already gone counts as cleared.
    }
    return Response.json({ reclaimed: true });
  });
}
