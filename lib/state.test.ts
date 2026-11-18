import { describe, expect, it } from "vitest";
import { parseState, serializeState, type WorkbookState } from "./state";

const state: WorkbookState = {
  v: 1,
  fileName: "groups.xlsx",
  sheets: [
    {
      name: "Bus A",
      headers: ["Item Code", "Item Name", "Remarks"],
      rows: [{ id: "Bus A:2", cells: ["X1", "Widget", "same"], remarks: "same" }],
      map: { code: 0, name: 1, brand: -1 },
      remarksCol: 2,
    },
  ],
};

describe("parseState", () => {
  it("round-trips serializeState", () => {
    expect(parseState(serializeState(state))).toEqual(state);
  });

  it("rejects another version", () => {
    expect(() => parseState(JSON.stringify({ ...state, v: 2 }))).toThrow();
    expect(() => parseState(JSON.stringify({ v: 2 }))).toThrow();
  });

  it("rejects non-JSON", () => {
    expect(() => parseState("not json")).toThrow();
  });

  it("rejects a wrong shape", () => {
    expect(() => parseState(JSON.stringify({ v: 1, fileName: "a.xlsx" }))).toThrow();
    expect(() => parseState(JSON.stringify({ v: 1, fileName: 3, sheets: [] }))).toThrow();
    expect(() => parseState(JSON.stringify({ v: 1, fileName: "a", sheets: [{ name: "S" }] }))).toThrow();
    expect(() => parseState("null")).toThrow();
  });
});
