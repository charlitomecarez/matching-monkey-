// Saved-state file encoding: gzip-compressed JSON. Uses the web CompressionStream API, available in
// browsers and Node 18+. No SDK imports.
import { parseState, serializeState, type WorkbookState } from "./state";

/**
 * Largest state file the app will store: the browser SDK's chunk size (appwrite `Client.CHUNK_SIZE`,
 * 5 MiB). Anything bigger would be uploaded in chunks, and a chunked upload to an existing file id
 * resumes instead of failing with 409 — which would break the "file id is the commit gate" rule.
 */
export const MAX_STATE_BYTES = 5 * 1024 * 1024;

export const STATE_TOO_LARGE_MESSAGE = "This workbook is too large to save.";

export class StateTooLargeError extends Error {
  constructor() {
    super(STATE_TOO_LARGE_MESSAGE);
    this.name = "StateTooLargeError";
  }
}

/** gzip-compressed JSON of the state. Throws StateTooLargeError above `maxBytes`. */
export async function encodeState(state: WorkbookState, maxBytes = MAX_STATE_BYTES): Promise<Blob> {
  const stream = new Blob([serializeState(state)]).stream().pipeThrough(new CompressionStream("gzip"));
  const blob = new Blob([await new Response(stream).arrayBuffer()], { type: "application/gzip" });
  if (blob.size > maxBytes) throw new StateTooLargeError();
  return blob;
}

const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Parses a stored state: gzip (magic bytes 1f 8b) or an older uncompressed JSON file. */
export async function decodeState(bytes: Uint8Array): Promise<WorkbookState> {
  if (!isGzip(bytes)) return parseState(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return parseState(await new Response(stream).text());
}
