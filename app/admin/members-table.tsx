"use client";

import { useState, useTransition } from "react";
import { deleteUserAndData, revokeMember, setAdmin, type ActionResult, type MemberRow } from "./actions";

export default function MembersTable({ members, currentUserId }: { members: MemberRow[]; currentUserId: string }) {
  if (members.length === 0) return <p className="text-sm text-muted">No members yet.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <MemberRowView key={m.membershipId} member={m} self={m.userId === currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberRowView({ member, self }: { member: MemberRow; self: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const run = (action: () => Promise<ActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else {
        setConfirming(false);
        setTyped("");
      }
    });
  };

  const matches = typed.trim().toLowerCase() === member.email.toLowerCase();
  const confirmId = `confirm-${member.membershipId}`;

  return (
    <>
      <tr className="border-b border-line last:border-b-0 align-top">
        <td className="px-3 py-2">
          {member.email}
          {self && <span className="text-muted"> (you)</span>}
        </td>
        <td className="px-3 py-2">{member.name || <span className="text-muted">—</span>}</td>
        <td className="px-3 py-2">{member.status === "joined" ? "Joined" : "Invited"}</td>
        <td className="px-3 py-2">{member.admin ? "Admin" : "Member"}</td>
        <td className="px-3 py-2">
          {self ? null : (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => run(() => setAdmin(member.membershipId, !member.admin))}
              >
                {member.admin ? "Remove admin" : "Make admin"}
              </button>
              <button type="button" className="btn" disabled={pending} onClick={() => run(() => revokeMember(member.membershipId))}>
                Revoke
              </button>
              <button
                type="button"
                className="btn text-red-700 dark:text-red-400"
                disabled={pending}
                aria-expanded={confirming}
                aria-controls={confirmId}
                onClick={() => {
                  setConfirming((v) => !v);
                  setTyped("");
                  setError(null);
                }}
              >
                Delete user
              </button>
            </div>
          )}
        </td>
      </tr>
      {(confirming || error) && (
        <tr className="border-b border-line last:border-b-0">
          <td colSpan={5} className="px-3 py-2">
            {confirming && (
              <form
                id={confirmId}
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (matches) run(() => deleteUserAndData(member.userId, typed));
                }}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span>
                    This permanently deletes the account and all of its uploads. Type{" "}
                    <strong className="font-semibold">{member.email}</strong> to confirm.
                  </span>
                  <input
                    className="field w-72 max-w-full"
                    type="email"
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={!matches || pending}>
                  {pending ? "Deleting…" : "Delete permanently"}
                </button>
                <button type="button" className="btn" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </form>
            )}
            {error && (
              <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
