"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Sheet } from "@/lib/items";
import { retryDelayMs } from "@/lib/save-plan";
import { ApiError, SaveBusyError, downloadOriginal, loadState, saveState } from "@/lib/upload-client";
import type { UploadMeta } from "@/lib/uploads";
import MatchingApp, { type SaveStatus } from "../../matching-app";

const DEBOUNCE_MS = 1500;

type Autosaver = {
  change: (sheets: Sheet[]) => void;
  /** Save now instead of waiting for the debounce (tab hidden, page left). */
  flushNow: () => void;
  /** An edit is not saved yet, or a save is in flight. */
  pending: () => boolean;
};

/**
 * Debounced autosave: one save in flight at a time, always saving the latest sheets. Network errors
 * retry with backoff and keep the edits; a conflict stops autosaving.
 */
function createAutosaver(
  meta: UploadMeta,
  fileName: string,
  initial: Sheet[],
  report: (status: SaveStatus, message?: string) => void,
): Autosaver {
  let latest = initial;
  let saved = initial;
  let version = meta.version;
  let inFlight = false;
  let stopped = false; // after a conflict
  let failing = false;
  let failures = 0;
  let notBefore = 0; // backoff: no save starts before this time
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dirty = () => latest !== saved;

  function schedule(ms: number) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = null;
        void flush();
      },
      Math.max(ms, notBefore - Date.now()),
    );
  }

  function retryLater(ms: number) {
    notBefore = Date.now() + ms;
    schedule(ms);
  }

  async function flush() {
    if (stopped || inFlight || !dirty()) return;
    inFlight = true;
    if (!failing) report("saving");
    const snapshot = latest;
    try {
      const result = await saveState(meta, { v: 1, fileName, sheets: snapshot }, version);
      if ("conflict" in result) {
        stopped = true;
        if (timer) clearTimeout(timer);
        report("conflict", result.conflict);
        return;
      }
      version = result.version;
      saved = snapshot;
      failing = false;
      failures = 0;
      notBefore = 0;
    } catch (e) {
      if (e instanceof SaveBusyError) {
        report("saving");
        retryLater(e.retryInMs);
      } else {
        failing = true;
        failures += 1;
        const signedOut = e instanceof ApiError && (e.status === 401 || e.status === 403);
        report("error", signedOut ? "You're signed out. Sign in again in another tab to keep saving." : undefined);
        retryLater(retryDelayMs(failures));
      }
      return;
    } finally {
      inFlight = false;
    }
    if (!dirty()) report("saved");
    else if (!timer) void flush(); // edits arrived while saving and their debounce already fired
  }

  return {
    change(sheets) {
      latest = sheets;
      if (stopped) return;
      if (!failing) report("saving");
      schedule(DEBOUNCE_MS);
    },
    flushNow() {
      if (stopped || !timer || Date.now() < notBefore) return;
      clearTimeout(timer);
      timer = null;
      void flush();
    },
    pending: () => dirty() || inFlight,
  };
}

type Loaded = { fileName: string; sheets: Sheet[] };

export default function Workbook({ meta }: { meta: UploadMeta }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string | undefined>();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const saver = useRef<Autosaver | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadState(meta).then(
      (state) => {
        if (cancelled) return;
        saver.current = createAutosaver(meta, state.fileName, state.sheets, (s, m) => {
          setStatus(s);
          setMessage(m);
        });
        setData({ fileName: state.fileName, sheets: state.sheets });
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [meta, attempt]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!saver.current?.pending()) return;
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    };
    const flush = () => saver.current?.flushNow();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(); // leaving via in-app navigation: save now; the save finishes in the background
    };
  }, []);

  const onChange = useCallback((sheets: Sheet[]) => {
    setData((d) => d && { ...d, sheets });
    saver.current?.change(sheets);
  }, []);

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
  if (!data) {
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
        sheets={data.sheets}
        onChange={onChange}
        saveStatus={status}
        saveMessage={message}
        onDownloadOriginal={onDownloadOriginal}
      />
    </>
  );
}
