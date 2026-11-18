import { logout } from "./login/actions";

/** Shown to a signed-in account that is not (or no longer) a member, or whose session expired. */
export default function NoAccess() {
  return (
    <div className="flex flex-col items-start gap-3 text-sm">
      <p>You don&apos;t have access.</p>
      <form action={logout}>
        <button className="btn">Sign in with another account</button>
      </form>
    </div>
  );
}
