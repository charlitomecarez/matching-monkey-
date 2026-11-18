import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { IDS } from "@/lib/appwrite/config";
import AcceptInviteForm from "./invite-form";

export const metadata: Metadata = { title: "Accept invite · Item Matching" };

export default function InvitePage({ searchParams }: PageProps<"/invite">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-line p-6">
        <h1 className="text-lg font-semibold">Item Matching</h1>
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <InviteContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function InviteContent({ searchParams }: { searchParams: PageProps<"/invite">["searchParams"] }) {
  const sp = await searchParams;
  const params = {
    userId: one(sp.userId),
    membershipId: one(sp.membershipId),
    secret: one(sp.secret),
    teamId: one(sp.teamId),
  };

  if (!params.userId || !params.membershipId || !params.secret || params.teamId !== IDS.team) {
    return (
      <p className="mt-2 text-sm">
        This invite link is invalid or was already used.{" "}
        <Link href="/login" className="underline">
          Go to sign in
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <p className="mb-6 text-sm text-muted">You were invited. Choose a password to finish joining.</p>
      <AcceptInviteForm params={params} />
    </>
  );
}
