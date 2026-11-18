"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { savers, type BackgroundProblem } from "@/lib/autosave";

const NONE: BackgroundProblem[] = [];

/** Saves that failed after their workbook page was left (they keep retrying in the background). */
export default function BackgroundSaves() {
  const problems = useSyncExternalStore(
    savers.subscribe,
    savers.problems,
    () => NONE,
  );
  if (!problems.length) return null;
  return (
    <div
      role="alert"
      className="border-b border-red-300 bg-red-50 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      <ul className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-2 sm:px-6">
        {problems.map((p) => (
          <li key={p.id}>
            {p.status === "conflict" ? (
              <>
                An earlier change to <b>{p.name}</b> couldn&apos;t be saved
                because it was changed in another tab or device —{" "}
              </>
            ) : (
              <>
                An earlier change to <b>{p.name}</b> couldn&apos;t be saved yet
                —{" "}
              </>
            )}
            <Link href={`/uploads/${p.id}`} className="underline">
              {p.status === "conflict"
                ? "open it to reload"
                : "open it to retry"}
            </Link>
            .
          </li>
        ))}
      </ul>
    </div>
  );
}
