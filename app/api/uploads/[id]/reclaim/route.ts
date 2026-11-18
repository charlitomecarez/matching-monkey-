import type { Models } from "node-appwrite";
import { createAdminClient } from "@/lib/appwrite/server";
import { IDS } from "@/lib/appwrite/config";
import { requireMember } from "@/lib/auth";
import { CONFLICT_MESSAGE, SAVE_IN_PROGRESS_MESSAGE, canReclaim, parseReclaimBody, planReclaim } from "@/lib/uploads";
import { getOwnedRow, handle, isNotFound, readJson } from "@/lib/uploads-server";

/**
 * Clears an orphaned `<id>.v(N+1)` state file (a tab that died between createFile and commit) so
 * saves from version N can continue. Only files at least RECLAIM_MIN_AGE_MS old are deleted; the
 * commit route refuses files older than COMMIT_MAX_AGE_MS, so a reclaimed file can never be one
 * that still gets committed. The file is deleted whoever owns it: its id is in this user's
 * upload's namespace, so this also clears a file squatted there by someone else.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/uploads/[id]/reclaim">) {
  return handle(async () => {
    const user = await requireMember();
    const { id } = await ctx.params;
    const { baseVersion } = parseReclaimBody(await readJson(request));
    const { tables, storage } = createAdminClient();

    const row = await getOwnedRow(tables, id, user.id);
    const plan = planReclaim(row, id, baseVersion);
    if (!plan.ok) return Response.json({ error: CONFLICT_MESSAGE }, { status: 409 });

    let file: Models.File;
    try {
      file = await storage.getFile({ bucketId: IDS.states, fileId: plan.fileId });
    } catch (e) {
      if (isNotFound(e)) return Response.json({ reclaimed: false });
      throw e;
    }
    if (!canReclaim(file.$createdAt, Date.now())) {
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
