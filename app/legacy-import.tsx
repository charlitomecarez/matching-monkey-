"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { writeWorkbook } from "@/lib/excel";
import { LEGACY_KEY, readLegacy } from "@/lib/legacy";
import type { WorkbookState } from "@/lib/state";
import { createUpload } from "@/lib/upload-client";
import type { UploadMeta } from "@/lib/uploads";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const readRaw = () => {
  try {
    return localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
};

function removeLegacy() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // storage unavailable; nothing to remove
  }
  listeners.forEach((cb) => cb());
}

/** Offers to move a workbook saved in this browser by the old version into the account. */
export default function LegacyImport({ onSaved }: { onSaved: (meta: UploadMeta) => void }) {
  // Server snapshot is null, so nothing renders during SSR; storage is read on the client only.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const legacy = useMemo(() => readLegacy(raw), [raw]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!legacy) return null;

  async function save(state: WorkbookState) {
    setBusy(true);
    setError(null);
    try {
      const name = /\.xlsx$/i.test(state.fileName) ? state.fileName : `${state.fileName || "Workbook"}.xlsx`;
      const meta = await createUpload(new File([await writeWorkbook(state.sheets)], name));
      removeLegacy();
      onSaved(meta);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <section aria-label="Workbook from the old version" className="rounded-md border border-line bg-subtle p-3 text-sm">
      <p>
        A workbook from the old version is saved in this browser: <b>{legacy.fileName}</b>. Save it to your account?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save(legacy)}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            removeLegacy();
          }}
        >
          Discard
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
