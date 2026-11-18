import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/appwrite/server";
import { getCurrentUser } from "@/lib/auth";
import { NotFound, UPLOAD_ID_RE, toUploadMeta } from "@/lib/uploads";
import { getOwnedRow } from "@/lib/uploads-server";
import NoAccess from "../../no-access";
import Workbook from "./workbook";

export const metadata: Metadata = { title: "Workbook · Item Matching" };

export default function UploadPage({ params }: PageProps<"/uploads/[id]">) {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-7xl px-4 py-6 text-sm text-muted sm:px-6">Loading…</p>}>
      <UploadContent params={params} />
    </Suspense>
  );
}

async function UploadContent({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <NoAccess />
      </main>
    );
  }

  const { id } = await params;
  if (!UPLOAD_ID_RE.test(id)) notFound();

  let row;
  try {
    row = await getOwnedRow(createAdminClient().tables, id, user.id);
  } catch (e) {
    if (e instanceof NotFound) notFound(); // missing or someone else's: same answer
    throw e;
  }

  return (
    <main className="flex-1">
      <Workbook key={row.$id} meta={toUploadMeta(row)} />
    </main>
  );
}
