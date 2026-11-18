// Excel import/export (browser only — exceljs is loaded on demand).
import type { Workbook, Worksheet } from "exceljs";
import {
  GENERATED_SHEETS,
  REMARKS,
  buildDecision,
  buildDuplicates,
  buildGroupTotals,
  buildNewItems,
  detectColumns,
  findRemarksCol,
  toItems,
  toRemark,
  type Sheet,
} from "./items";

const loadExcel = async () => (await import("exceljs")).default;

function rowTexts(ws: Worksheet, rowNumber: number, width: number): string[] {
  const row = ws.getRow(rowNumber);
  const out: string[] = [];
  for (let c = 1; c <= width; c++) {
    let text = "";
    try {
      text = row.getCell(c).text ?? "";
    } catch {
      const v = row.getCell(c).value;
      text = v == null ? "" : String(v);
    }
    out.push(text.trim());
  }
  return out;
}

/** Reads every non-generated sheet as one bus group. */
export async function readWorkbook(file: File): Promise<Sheet[]> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    if (GENERATED_SHEETS.includes(ws.name)) return;
    const width = ws.actualColumnCount ? ws.columnCount : 0;
    const last = ws.rowCount;
    if (!width || !last) return;

    // Header row: the first of the top 15 rows whose headers we recognise,
    // otherwise the first non-empty row.
    let headerRow = -1;
    let firstNonEmpty = -1;
    for (let r = 1; r <= Math.min(last, 15); r++) {
      const cells = rowTexts(ws, r, width);
      if (cells.every((c) => !c)) continue;
      if (firstNonEmpty < 0) firstNonEmpty = r;
      const m = detectColumns(cells);
      if (m.code >= 0 && m.name >= 0) {
        headerRow = r;
        break;
      }
    }
    if (headerRow < 0) headerRow = firstNonEmpty;
    if (headerRow < 0) return;

    const headers = rowTexts(ws, headerRow, width).map((h, i) => h || `Column ${i + 1}`);
    const remarksCol = findRemarksCol(headers);
    const rows: Sheet["rows"] = [];
    for (let r = headerRow + 1; r <= last; r++) {
      const cells = rowTexts(ws, r, width);
      if (cells.every((c) => !c)) continue;
      rows.push({
        id: `${ws.name}:${r}`,
        cells,
        remarks: toRemark(remarksCol >= 0 ? cells[remarksCol] : undefined) ?? "active",
      });
    }
    sheets.push({ name: ws.name, headers, rows, map: detectColumns(headers), remarksCol });
  });
  return sheets;
}

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } } as const;

function addTable(wb: Workbook, name: string, headers: string[], rows: (string | number)[][]) {
  const ws = wb.addWorksheet(name);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((c) => (c.fill = HEADER_FILL));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));
  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.slice(0, 500).map((r) => String(r[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
  });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return ws;
}

/** Builds the output workbook: bus group sheets with Remarks + the summary sheets. */
export async function writeWorkbook(sheets: Sheet[]): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const items = toItems(sheets);

  // Dashboard first so it opens on top.
  const totals = buildGroupTotals(sheets);
  addTable(
    wb,
    "Dashboard",
    ["Bus Group", "Total Items", "Active", "Same", "Inactive"],
    [
      ...totals.map((t) => [t.group, t.total, t.active, t.same, t.inactive]),
      [
        "TOTAL",
        ...(["total", "active", "same", "inactive"] as const).map((k) =>
          totals.reduce((n, t) => n + t[k], 0),
        ),
      ],
    ],
  ).lastRow!.font = { bold: true };

  for (const s of sheets) {
    const remarksIdx = s.remarksCol >= 0 ? s.remarksCol : s.headers.length;
    const headers = [...s.headers];
    headers[remarksIdx] = "Remarks";
    const rows = s.rows.map((r) => {
      const cells: (string | number)[] = [...r.cells];
      cells[remarksIdx] = r.remarks;
      return cells;
    });
    const ws = addTable(wb, s.name, headers, rows);
    for (let r = 2; r <= rows.length + 1; r++) {
      ws.getCell(r, remarksIdx + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${REMARKS.join(",")}"`],
      };
    }
  }

  addTable(
    wb,
    "Decision",
    ["Item Code", "Item Name", "Brand", "Bus Groups", "Occurrences"],
    buildDecision(items).map((d) => [d.code, d.name, d.brand, d.groups.join(", "), d.count]),
  );
  addTable(
    wb,
    "New Items",
    ["Bus Group", "Item Code", "Item Name", "Brand", "Remarks"],
    buildNewItems(items).map((it) => [it.group, it.code, it.name, it.brand, it.remarks]),
  );
  addTable(
    wb,
    "Duplication",
    ["Duplicate #", "Matched On", "Bus Group", "Item Code", "Item Name", "Brand", "Remarks"],
    buildDuplicates(items).map((d) => [d.dupId, d.matchOn, d.group, d.code, d.name, d.brand, d.remarks]),
  );

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
