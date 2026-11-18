"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUpload, deleteUpload, downloadOriginal, listUploads, renameUpload } from "@/lib/upload-client";
import { MAX_NAME, type UploadMeta } from "@/lib/uploads";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function UploadsList({ initial }: { initial: UploadMeta[] }) {
  const router = useRouter();
  const [uploads, setUploads] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The router may show a cached copy of this page; refresh "last edited" from the server.
  useEffect(() => {
    let cancelled = false;
    listUploads().then(
      (fresh) => {
        if (!cancelled) setUploads(fresh);
      },
      () => {}, // keep the server-rendered list
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function onUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const meta = await createUpload(file);
      router.push(`/uploads/${meta.id}`);
    } catch (e) {
      setError(errorText(e));
      setUploading(false);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Your uploads</h1>
          <p className="text-sm text-muted">Upload an Excel workbook with one sheet per bus group.</p>
        </div>
        <label className={`btn btn-primary ${uploading ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          {uploading ? "Uploading…" : "Upload Excel"}
          <input
            type="file"
            accept=".xlsx"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {uploads.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
          No uploads yet — upload an Excel workbook to start.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Uploaded</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Last edited</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <UploadRow
                  key={u.id}
                  upload={u}
                  onRenamed={(next) => setUploads((list) => list.map((x) => (x.id === next.id ? next : x)))}
                  onDeleted={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function UploadRow({
  upload,
  onRenamed,
  onDeleted,
}: {
  upload: UploadMeta;
  onRenamed: (u: UploadMeta) => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(upload.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  const onRename = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === upload.name) {
      setMode("view");
      return;
    }
    void run(async () => {
      onRenamed(await renameUpload(upload.id, trimmed));
      setMode("view");
    });
  };

  const startMode = (m: "view" | "rename" | "delete") => {
    setMode(m);
    setName(upload.name);
    setError(null);
  };

  return (
    <>
      <tr className="border-t border-line align-middle">
        <td className="px-3 py-2">
          {mode === "rename" ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={onRename}>
              <input
                className="field min-w-48 flex-1"
                value={name}
                maxLength={MAX_NAME}
                autoFocus
                aria-label="New name"
                disabled={pending}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") startMode("view");
                }}
              />
              <button className="btn btn-primary" disabled={pending || !name.trim()}>
                Save
              </button>
              <button type="button" className="btn" disabled={pending} onClick={() => startMode("view")}>
                Cancel
              </button>
            </form>
          ) : (
            <Link href={`/uploads/${upload.id}`} className="font-medium hover:underline">
              {upload.name}
            </Link>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-muted">
          <LocalTime iso={upload.createdAt} />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-muted">
          <LocalTime iso={upload.updatedAt} />
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{upload.rowCount.toLocaleString("en-US")}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap justify-end gap-2">
            <Link href={`/uploads/${upload.id}`} className="btn">
              Open
            </Link>
            <button className="btn" disabled={pending} onClick={() => startMode(mode === "rename" ? "view" : "rename")}>
              Rename
            </button>
            <button className="btn" disabled={pending} onClick={() => void run(() => downloadOriginal(upload))}>
              Download original
            </button>
            <button
              className="btn text-red-700 dark:text-red-400"
              disabled={pending}
              aria-expanded={mode === "delete"}
              onClick={() => startMode(mode === "delete" ? "view" : "delete")}
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {(mode === "delete" || error) && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            {mode === "delete" && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <span className="flex-1">
                  Delete <b>{upload.name}</b>? The original file and all saved Remarks are removed. This can&apos;t be
                  undone.
                </span>
                <button
                  className="btn text-red-700 dark:text-red-400"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await deleteUpload(upload.id);
                      onDeleted();
                    })
                  }
                >
                  {pending ? "Deleting…" : "Delete"}
                </button>
                <button className="btn" disabled={pending} onClick={() => startMode("view")}>
                  Cancel
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const subscribeNever = () => () => {};

/** Local date/time after hydration; the server (other time zone) renders the UTC date only. */
function LocalTime({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  return (
    <time dateTime={iso}>
      {hydrated ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : iso.slice(0, 10)}
    </time>
  );
}
