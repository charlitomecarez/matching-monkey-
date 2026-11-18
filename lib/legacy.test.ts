import { describe, expect, it } from "vitest";
import { readLegacy } from "./legacy";

const sheet = {
  name: "Bus A",
  headers: ["Item Code", "Item Name"],
  rows: [{ id: "Bus A:2", cells: ["X1", "Widget"], remarks: "same" }],
  map: { code: 0, name: 1, brand: -1 },
  remarksCol: -1,
};

describe("readLegacy", () => {
  it("returns a v1 state for the old shape", () => {
    expect(readLegacy(JSON.stringify({ fileName: "old.xlsx", sheets: [sheet] }))).toEqual({
      v: 1,
      fileName: "old.xlsx",
      sheets: [sheet],
    });
  });

  it("returns null for missing or garbage input", () => {
    expect(readLegacy(null)).toBeNull();
    expect(readLegacy("")).toBeNull();
    expect(readLegacy("not json")).toBeNull();
    expect(readLegacy("null")).toBeNull();
    expect(readLegacy("[]")).toBeNull();
    expect(readLegacy(JSON.stringify({ fileName: "a.xlsx" }))).toBeNull();
    expect(readLegacy(JSON.stringify({ fileName: 3, sheets: [sheet] }))).toBeNull();
    expect(readLegacy(JSON.stringify({ fileName: "a.xlsx", sheets: [{ name: "S" }] }))).toBeNull();
    expect(readLegacy(JSON.stringify({ fileName: "a.xlsx", sheets: [] }))).toBeNull();
  });
});
