"use client";

import { useActionState, useEffect, useRef } from "react";
import { inviteMember, type ActionResult } from "./actions";

type State = ActionResult & { sent: number };

const initialState: State = { error: null, sent: 0 };

async function invite(prev: State, formData: FormData): Promise<State> {
  const result = await inviteMember(prev, formData);
  return { error: result.error, sent: result.error ? prev.sent : prev.sent + 1 };
}

export default function InviteForm() {
  const [state, formAction, pending] = useActionState(invite, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.sent > 0) formRef.current?.reset();
  }, [state.sent]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2" noValidate>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Email</span>
          <input
            className="field w-72 max-w-full"
            type="email"
            name="email"
            autoComplete="off"
            required
            aria-invalid={state.error ? true : undefined}
            aria-describedby="invite-status"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      <p id="invite-status" role="status" className="min-h-5 text-sm">
        {state.error ? (
          <span className="text-red-700 dark:text-red-400">{state.error}</span>
        ) : state.sent > 0 ? (
          <span className="text-muted">Invite sent.</span>
        ) : null}
      </p>
    </form>
  );
}
