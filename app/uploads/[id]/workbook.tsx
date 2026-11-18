"use client";

import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { Autosaver, installUnloadGuard, savers, type SaverView } from "@/lib/autosave";
import type { Sheet } from "@/lib/items";
import { ApiError, SaveBusyError, downloadOriginal, loadState, saveState } from "@/lib/upload-client";
import type { UploadMeta } from "@/lib/uploads";
import MatchingApp from "../../matching-app";

function newSaver(meta: UploadMeta, fileName: string, sheets: Sheet[]): Autosaver {
  return new Autosaver({
    id: meta.id,
    name: meta.name,
    fileName,
    sheets,
    version: meta.version,
    save: (state, baseVersion) => saveState(meta, state, baseVersion),
    busyRetryMs: (e) => (e instanceof SaveBusyError ? e.retryInMs : null),
    describeError: (e) =>
      e instanceof ApiError && (e.status === 401 || e.status === 403)
        ? "You're signed out. Sign in again in another tab to keep saving."
        : undefined,
  });
}

const noSubscribe = () => () => {};
const IDLE: SaverView = { status: "saved", sheets: [] };

export default function Workbook({ meta }: { meta: UploadMeta }) {
  const id = meta.id;
  // Reopened before an earlier save of this upload finished: continue from that saver (its latest
  // sheets and version) instead of loading the older state from Storage.
  const [saver, setSaver] = useState<Autosaver | null>(() => savers.get(id) ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useEffectEvent(() => loadState(meta));

  useEffect(() => {
    installUnloadGuard();
    if (saver) {
      savers.attach(saver);
      return () => savers.release(saver); // saves now; the save finishes in the background
    }
    let cancelled = false;
    load().then(
      (state) => {
        if (cancelled) return;
        setSaver(savers.get(id) ?? newSaver(meta, state.fileName, state.sheets));
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
    // `meta` is read through `load`/the initial props only: a re-render with an equal upload must not
    // reload the state or replace the saver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver, id, attempt]);

  const view = useSyncExternalStore(
    saver ? saver.subscribe : noSubscribe,
    () => saver?.view ?? IDLE,
    () => IDLE,
  );

  const onChange = useCallback((sheets: Sheet[]) => saver?.change(sheets), [saver]);

  const onDownloadOriginal = useCallback(() => {
    setDownloadError(null);
    downloadOriginal(meta).catch((e: unknown) => setDownloadError(e instanceof Error ? e.message : String(e)));
  }, [meta]);

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <p role="alert" className="text-sm">
          Couldn&apos;t open this upload: {loadError}
        </p>
        <button
          className="btn mt-3"
          onClick={() => {
            setLoadError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!saver) {
    return <p className="mx-auto w-full max-w-7xl px-4 py-6 text-sm text-muted sm:px-6">Loading workbook…</p>;
  }

  return (
    <>
      {downloadError && (
        <p
          role="alert"
          className="mx-auto mt-4 w-full max-w-7xl rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          Couldn&apos;t download the original: {downloadError}
        </p>
      )}
      <MatchingApp
        fileName={meta.name}
        sheets={view.sheets}
        onChange={onChange}
        saveStatus={view.status}
        saveMessage={view.message}
        onDownloadOriginal={onDownloadOriginal}
      />
    </>
  );
}
