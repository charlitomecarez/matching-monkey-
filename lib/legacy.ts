// Reads the workbook the old, browser-only version kept in localStorage. Pure; no storage access here.
import { parseState, type WorkbookState } from "./state";

export const LEGACY_KEY = "matching-monkey:workbook:v1";

/** Old shape `{ fileName, sheets }` -> current state; null when missing or invalid. */
export function readLegacy(raw: string | null): WorkbookState | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const { fileName, sheets } = data as Record<string, unknown>;
    // The old payload had no version; validate it with the same checks as saved state.
    const state = parseState(JSON.stringify({ v: 1, fileName, sheets }));
    return state.sheets.length > 0 ? state : null;
  } catch {
    return null;
  }
}
