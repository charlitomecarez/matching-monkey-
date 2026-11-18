"use client";

import { useActionState } from "react";
import { acceptInvite, type InviteState } from "./actions";

const initialState: InviteState = { error: null };

export type InviteParams = { userId: string; membershipId: string; secret: string; teamId: string };

export default function AcceptInviteForm({ params }: { params: InviteParams }) {
  const [state, formAction, pending] = useActionState(acceptInvite, initialState);
  const describedBy = state.error ? "invite-error" : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="userId" value={params.userId} />
      <input type="hidden" name="membershipId" value={params.membershipId} />
      <input type="hidden" name="secret" value={params.secret} />
      <input type="hidden" name="teamId" value={params.teamId} />
      <label className="flex flex-col gap-1 text-sm">
        <span>Password (at least 8 characters)</span>
        <input
          className="field"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={describedBy}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Confirm password</span>
        <input
          className="field"
          type="password"
          name="confirm"
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={describedBy}
        />
      </label>
      <p id="invite-error" role="alert" className="min-h-5 text-sm text-red-700 dark:text-red-400">
        {state.error}
      </p>
      <button type="submit" className="btn btn-primary justify-center" disabled={pending}>
        {pending ? "Joining…" : "Set password and join"}
      </button>
    </form>
  );
}
