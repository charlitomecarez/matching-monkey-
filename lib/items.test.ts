import { describe, expect, it } from "vitest";
import {
  buildDecision,
  buildDuplicates,
  detectColumns,
  findRemarksCol,
  nameKey,
  type Item,
} from "./items";

const item = (id: string, group: string, code: string, name: string, brand: string, remarks: Item["remarks"] = "active"): Item => ({
  id, group, code, name, brand, remarks,
});

describe("buildDecision", () => {
  it("drops inactive rows and dedupes codes case/whitespace-insensitively", () => {
    const out = buildDecision([
      item("1", "G1", "A001", "Corned Beef 150G", "Purefoods"),
      item("2", "G2", "a001 ", "Corned Beef", "Argentina"),
      item("3", "G1", "B100", "Tuna", "X", "inactive"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: "A001", count: 2, groups: ["G1", "G2"] });
  });
});

describe("nameKey", () => {
  it("ignores case, punctuation and word order", () => {
    expect(nameKey("150g Corned-Beef")).toBe(nameKey("corned beef 150G"));
  });
});

describe("buildDuplicates", () => {
  it("clusters transitively by code and by name", () => {
    const out = buildDuplicates([
      item("1", "G1", "A001", "Corned Beef 150G", "Purefoods"),
      item("2", "G2", "a001", "Argentina Corned", "Argentina"),
      item("3", "G3", "C300", "150g corned beef", "CDO"),
      item("4", "G3", "Z999", "Unrelated", "Q"),
    ]);
    const ids = out.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["1", "2", "3"]));
    expect(ids).not.toContain("4");
    expect(new Set(out.map((d) => d.dupId)).size).toBe(1);
    expect(out.find((d) => d.code === "C300")!.matchOn).toBe("Item name");
  });
});

describe("column detection", () => {
  it("detects code, name, brand and remarks", () => {
    const headers = ["SKU", "Description", "Brand Name", "Remarks"];
    expect(detectColumns(headers)).toEqual({ code: 0, name: 1, brand: 2 });
    expect(findRemarksCol(headers)).toBe(3);
  });
});
