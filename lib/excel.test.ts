import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readWorkbook, writeWorkbook } from "./excel";

const asFile = (buf: ArrayBuffer | Buffer, name = "t.xlsx") =>
  ({ name, arrayBuffer: async () => buf }) as unknown as File;

async function sourceFile() {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Group A");
  a.addRow(["Report title"]);
  a.addRow([]);
  a.addRow(["Item Code", "Item Name", "Brand"]);
  a.addRow(["A001", "Corned Beef", "Purefoods"]);
  a.addRow(["A002", "Tuna", "Century"]);
  const b = wb.addWorksheet("Group B");
  b.addRow(["Item Code", "Item Name", "Brand", "Remarks"]);
  b.addRow(["B001", "Sardines", "Ligo", "inactive"]);
  b.addRow(["B002", "Milk", "Alaska", "same"]);
  b.addRow(["B003", "Rice", "Dinorado", "weird"]);
  return asFile(await wb.xlsx.writeBuffer());
}

describe("workbook round-trip", () => {
  it("reads, writes and re-reads preserving groups and remarks", async () => {
    const first = await readWorkbook(await sourceFile());
    expect(first.map((s) => s.name)).toEqual(["Group A", "Group B"]);
    expect(first[0].headers).toEqual(["Item Code", "Item Name", "Brand"]);
    expect(first[0].rows).toHaveLength(2);

    const blob = await writeWorkbook(first);
    const second = await readWorkbook(asFile(await blob.arrayBuffer()));
    const names = second.map((s) => s.name);
    expect(names).toEqual(["Group A", "Group B"]);
    for (const g of ["Dashboard", "Decision", "New Items", "Duplication"]) expect(names).not.toContain(g);

    const remarks = second.find((s) => s.name === "Group B")!.rows.map((r) => r.remarks);
    expect(remarks).toEqual(["inactive", "same", "active"]);
  });
});
