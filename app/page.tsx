import { Suspense } from "react";
import { createAdminClient } from "@/lib/appwrite/server";
import { getCurrentUser } from "@/lib/auth";
import { listUploadsFor } from "@/lib/uploads-server";
import NoAccess from "./no-access";
import UploadsList from "./uploads-list";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <HomeContent />
      </Suspense>
    </main>
  );
}

async function HomeContent() {
  const user = await getCurrentUser();
  if (!user) return <NoAccess />;
  const uploads = await listUploadsFor(createAdminClient().tables, user.id);
  return <UploadsList initial={uploads} />;
}
