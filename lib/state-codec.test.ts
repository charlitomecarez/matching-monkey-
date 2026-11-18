import { describe, expect, it } from "vitest";
import { MAX_STATE_BYTES, StateTooLargeError, decodeState, encodeState } from "./state-codec";
import { serializeState, type WorkbookState } from "./state";

const state: WorkbookState = {
  v: 1,
  fileName: "Book.xlsx",
  sheets: [
    {
      name: "Sheet1",
      headers: ["Code", "Name", "Brand"],
      rows: [{ id: "r1", cells: ["A1", "Widget", "Acme"], remarks: "same" }],
      map: { code: 0, name: 1, brand: 2 },
      remarksCol: 3,
    },
  ],
};

describe("state codec", () => {
  it("gzips the JSON (magic bytes 1f 8b) and round-trips it", async () => {
    const blob = await encodeState(state);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(await decodeState(bytes)).toEqual(state);
  });

  it("still loads an old uncompressed state", async () => {
    const bytes = new TextEncoder().encode(serializeState(state));
    expect(await decodeState(bytes)).toEqual(state);
  });

  it("refuses a state whose compressed size exceeds the limit", async () => {
    await expect(encodeState(state, 10)).rejects.toBeInstanceOf(StateTooLargeError);
    await expect(encodeState(state, 10)).rejects.toThrow("This workbook is too large to save.");
  });

  it("limit is the browser SDK's single-request size (5 MiB)", () => {
    expect(MAX_STATE_BYTES).toBe(5 * 1024 * 1024);
  });
});
