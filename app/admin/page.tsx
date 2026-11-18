import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listMembers } from "./actions";
import InviteForm from "./invite-form";
import MembersTable from "./members-table";

export const metadata: Metadata = { title: "Admin · Item Matching" };

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link href="/" className="btn">
          Back to matching
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <AdminContent />
      </Suspense>
    </main>
  );
}

async function AdminContent() {
  const user = await getCurrentUser();
  if (!user?.admin) return <p className="text-sm">Admins only.</p>;

  const members = await listMembers();
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Invite someone</h2>
        <p className="text-sm text-muted">They get an email with a link to set their password.</p>
        <InviteForm />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Members</h2>
        <MembersTable members={members} currentUserId={user.id} />
      </section>
    </>
  );
}
