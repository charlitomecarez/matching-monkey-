import { createAdminClient, createSessionClient } from "@/lib/appwrite/server";
import { requireMember } from "@/lib/auth";
import { handle } from "@/lib/uploads-server";

/** Short-lived Appwrite JWT for direct browser uploads, bound to the caller's current session. */
export async function GET() {
  return handle(async () => {
    const user = await requireMember();
    const session = await createSessionClient(user.secret).account.getSession({ sessionId: "current" });
    const { jwt } = await createAdminClient().users.createJWT({ userId: user.id, sessionId: session.$id });
    return Response.json({ jwt, userId: user.id }, { headers: { "Cache-Control": "no-store" } });
  });
}
