import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "./login/actions";

/** Signed-in chrome. Reads the session: render inside <Suspense>. Renders nothing without a member session. */
export default async function SiteHeader() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm sm:px-6">
        <Link href="/" className="font-semibold">
          Item Matching
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted">{user.email}</span>
          {user.admin && (
            <Link href="/admin" className="hover:underline">
              Admin
            </Link>
          )}
          <form action={logout}>
            <button className="btn">Log out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
