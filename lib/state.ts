// Saved workbook state (the JSON kept in the `states` bucket). Pure; safe in browser and server.
import type { Sheet } from "./items";

export type WorkbookState = { v: 1; fileName: string; sheets: Sheet[] };

export function serializeState(s: WorkbookState): string {
  return JSON.stringify(s);
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function isSheet(x: unknown): x is Sheet {
  if (!isObject(x)) return false;
  const { name, headers, rows, map, remarksCol } = x;
  return (
    typeof name === "string" &&
    Array.isArray(headers) &&
    Array.isArray(rows) &&
    rows.every((r) => isObject(r) && typeof r.id === "string" && Array.isArray(r.cells) && typeof r.remarks === "string") &&
    isObject(map) &&
    typeof map.code === "number" &&
    typeof map.name === "number" &&
    typeof map.brand === "number" &&
    typeof remarksCol === "number"
  );
}

/** Parses a saved state; throws on non-JSON, another version, or a wrong shape. */
export function parseState(text: string): WorkbookState {
  const data: unknown = JSON.parse(text);
  if (!isObject(data) || data.v !== 1) throw new Error("Unsupported saved state version.");
  if (typeof data.fileName !== "string" || !Array.isArray(data.sheets) || !data.sheets.every(isSheet)) {
    throw new Error("Saved state is damaged.");
  }
  return { v: 1, fileName: data.fileName, sheets: data.sheets };
}
