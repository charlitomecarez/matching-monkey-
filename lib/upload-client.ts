// Browser-side upload operations. Files go straight to Appwrite Storage with a short-lived JWT;
// the app's API routes only receive ids and small metadata.
import { AppwriteException, ID, Permission, Role, type Storage } from "appwrite";
import { getBrowserStorage } from "./appwrite/browser";
import { IDS, PROJECT_ID } from "./appwrite/config";
import { readWorkbook } from "./excel";
import { nextSaveStep, type SaveOutcome, type SaveStep } from "./save-plan";
import { parseState, serializeState, type WorkbookState } from "./state";
import { MAX_NAME, SAVE_IN_PROGRESS_MESSAGE, stateFileIdFor, type UploadMeta } from "./uploads";

/** A non-2xx answer from one of the app's API routes. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Another save from the same version is still running; try again after `retryInMs`. */
export class SaveBusyError extends Error {
  constructor(public readonly retryInMs: number) {
    super(SAVE_IN_PROGRESS_MESSAGE);
    this.name = "SaveBusyError";
  }
}

// ---- API routes ----

async function api(path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  return fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
}

async function errorOf(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status}).`;
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string") message = data.error;
  } catch {}
  return new ApiError(res.status, message);
}

async function apiJson<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await api(path, init);
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

export function listUploads(): Promise<UploadMeta[]> {
  return apiJson<UploadMeta[]>("/api/uploads");
}

export function renameUpload(id: string, name: string): Promise<UploadMeta> {
  return apiJson<UploadMeta>(`/api/uploads/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
}

export async function deleteUpload(id: string): Promise<void> {
  const res = await api(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw await errorOf(res);
}

// ---- JWT + Storage ----

const JWT_MAX_AGE_MS = 10 * 60_000; // JWTs last 15 min
let jwtCache: { jwt: string; userId: string; at: number } | null = null;

async function getJwt(force = false): Promise<{ jwt: string; userId: string }> {
  if (!force && jwtCache && Date.now() - jwtCache.at < JWT_MAX_AGE_MS) return jwtCache;
  const { jwt, userId } = await apiJson<{ jwt: string; userId: string }>("/api/jwt");
  jwtCache = { jwt, userId, at: Date.now() };
  return jwtCache;
}

const isCode = (e: unknown, code: number) => e instanceof AppwriteException && e.code === code;

/** Runs a Storage call with a cached JWT; refreshes the JWT and retries once on 401. */
async function withStorage<T>(fn: (storage: Storage, userId: string) => Promise<T>): Promise<T> {
  const first = await getJwt();
  try {
    return await fn(getBrowserStorage(first.jwt), first.userId);
  } catch (e) {
    if (!isCode(e, 401)) throw e;
    const fresh = await getJwt(true);
    return fn(getBrowserStorage(fresh.jwt), fresh.userId);
  }
}

/** Owner-only permissions; the server checks for exactly read("user:<id>"). */
function ownerPermissions(userId: string): string[] {
  const role = Role.user(userId);
  return [Permission.read(role), Permission.update(role), Permission.delete(role)];
}

function stateFile(state: WorkbookState): File {
  return new File([serializeState(state)], "state.json", { type: "application/json" });
}

async function putFile(bucketId: string, fileId: string, file: File): Promise<void> {
  await withStorage((storage, userId) =>
    storage.createFile({ bucketId, fileId, file, permissions: ownerPermissions(userId) }),
  );
}

/** Downloads a file's bytes; the SDK only builds the URL, so the JWT goes in a header. */
async function fetchFile(bucketId: string, fileId: string): Promise<Response> {
  for (const force of [false, true]) {
    const { jwt } = await getJwt(force);
    const url = getBrowserStorage(jwt).getFileDownload({ bucketId, fileId });
    const res = await fetch(url, {
      headers: { "X-Appwrite-JWT": jwt, "X-Appwrite-Project": PROJECT_ID },
      cache: "no-store",
    });
    if (res.ok) return res;
    if (res.status !== 401 || force) throw new Error(`Could not download the file (${res.status}).`);
  }
  throw new Error("Could not download the file.");
}

// ---- Uploads ----

/**
 * Parses the workbook, stores the original and the first state file, then registers the upload.
 * The row id is chosen here so the first state file can be named stateFileIdFor(id, 1).
 */
export async function createUpload(file: File): Promise<UploadMeta> {
  const sheets = await readWorkbook(file);
  if (!sheets.length) throw new Error("No sheets with data were found in this file.");

  const id = ID.unique();
  const originalFileId = ID.unique();
  const stateFileId = stateFileIdFor(id, 1);
  const body = {
    id,
    name: file.name.slice(0, MAX_NAME).trim() || "Workbook.xlsx",
    originalFileId,
    stateFileId,
    rowCount: sheets.reduce((n, s) => n + s.rows.length, 0),
    sheetCount: sheets.length,
  };

  const created: [string, string][] = [];
  try {
    await putFile(IDS.originals, originalFileId, file);
    created.push([IDS.originals, originalFileId]);
    await putFile(IDS.states, stateFileId, stateFile({ v: 1, fileName: file.name, sheets }));
    created.push([IDS.states, stateFileId]);
  } catch (e) {
    await removeFiles(created);
    throw e;
  }

  let res: Response;
  try {
    res = await api("/api/uploads", { method: "POST", body });
  } catch {
    // The request may or may not have reached the server: retry once; 409 means it did.
    res = await api("/api/uploads", { method: "POST", body });
  }
  if (res.ok) return (await res.json()) as UploadMeta;
  if (res.status === 409) {
    const found = (await listUploads()).find((u) => u.id === id);
    if (found) return found;
  }
  const error = await errorOf(res);
  if (res.status !== 409) await removeFiles(created); // the row was not created
  throw error;
}

async function removeFiles(files: [string, string][]): Promise<void> {
  await Promise.all(
    files.map(([bucketId, fileId]) =>
      withStorage((storage) => storage.deleteFile({ bucketId, fileId })).catch(() => {}),
    ),
  );
}

export async function loadState(meta: UploadMeta): Promise<WorkbookState> {
  const res = await fetchFile(IDS.states, meta.stateFileId);
  return parseState(await res.text());
}

export async function downloadOriginal(meta: UploadMeta): Promise<void> {
  const blob = await (await fetchFile(IDS.originals, meta.originalFileId)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = /\.xlsx$/i.test(meta.name) ? meta.name : `${meta.name}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const MAX_SAVE_STEPS = 12;

/**
 * Saves `state` as version baseVersion + 1: create the state file (the id is the gate), then commit.
 * Resolves with the new version or a conflict message. Throws SaveBusyError when another save is
 * still in flight, and other errors for network / server failures (the caller retries; nothing is
 * committed in that case unless a later attempt finds it was).
 */
export async function saveState(
  meta: UploadMeta,
  state: WorkbookState,
  baseVersion: number,
): Promise<{ version: number } | { conflict: string }> {
  const fileId = stateFileIdFor(meta.id, baseVersion + 1);
  const base = `/api/uploads/${encodeURIComponent(meta.id)}`;
  let createdAt = 0;
  let lastError: unknown = null;
  let step: SaveStep = { kind: "create", retried: false };

  for (let i = 0; ; i++) {
    if (step.kind === "done") return { version: step.version };
    if (step.kind === "conflict") return { conflict: step.message };
    if (step.kind === "wait") throw new SaveBusyError(step.ms);
    if (step.kind === "error" || i >= MAX_SAVE_STEPS) throw lastError ?? new Error("Couldn't save.");

    let outcome: SaveOutcome;
    switch (step.kind) {
      case "create": {
        const retried = step.retried;
        const startedAt = Date.now(); // never later than the server's $createdAt
        try {
          await putFile(IDS.states, fileId, stateFile(state));
          createdAt = startedAt;
          outcome = { step: "create", result: "ok", retried };
        } catch (e) {
          if (isCode(e, 409)) outcome = { step: "create", result: "exists", retried };
          else {
            lastError = e;
            outcome = { step: "create", result: "error", retried };
          }
        }
        break;
      }

      case "reclaim": {
        try {
          const res = await api(`${base}/reclaim`, { method: "POST", body: { baseVersion } });
          if (res.ok) outcome = { step: "reclaim", result: "cleared" };
          else {
            const err = await errorOf(res);
            if (res.status === 409) {
              outcome = { step: "reclaim", result: err.message === SAVE_IN_PROGRESS_MESSAGE ? "busy" : "conflict" };
            } else {
              lastError = err;
              outcome = { step: "reclaim", result: "error" };
            }
          }
        } catch (e) {
          lastError = e;
          outcome = { step: "reclaim", result: "error" };
        }
        break;
      }

      case "commit": {
        try {
          const res = await api(`${base}/commit`, { method: "POST", body: { stateFileId: fileId, baseVersion } });
          if (res.ok) {
            const { version } = (await res.json()) as { version: number };
            outcome = { step: "commit", result: "ok", version };
          } else if (res.status === 409) {
            outcome = { step: "commit", result: "conflict" };
          } else {
            lastError = await errorOf(res);
            outcome = { step: "commit", result: "error" };
          }
        } catch (e) {
          lastError = e;
          outcome = { step: "commit", result: "error" };
        }
        break;
      }

      case "verify": {
        try {
          const current = (await listUploads()).find((u) => u.id === meta.id);
          if (current && current.stateFileId === fileId) {
            outcome = { step: "verify", result: "committed", version: current.version };
          } else if (current && current.version === baseVersion) {
            outcome = { step: "verify", result: "not-committed", sinceCreateMs: Date.now() - createdAt };
          } else {
            outcome = { step: "verify", result: "moved" }; // newer version elsewhere, or deleted
          }
        } catch (e) {
          lastError = e;
          outcome = { step: "verify", result: "error" };
        }
        break;
      }
    }
    step = nextSaveStep(outcome);
  }
}
