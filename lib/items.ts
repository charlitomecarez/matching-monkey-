// Pure data logic: types, column detection, and the derived sheets
// (Decision, New Items, Duplication, Dashboard totals).

export const REMARKS = ["active", "same", "inactive"] as const;
export type Remark = (typeof REMARKS)[number];

/** Sheet names this app generates; ignored when a workbook is re-uploaded. */
export const GENERATED_SHEETS = ["Decision", "New Items", "Duplication", "Dashboard"];

export type ColumnMap = { code: number; name: number; brand: number };

export type Row = { id: string; cells: string[]; remarks: Remark };

export type Sheet = {
  /** Bus group = the sheet name. */
  name: string;
  headers: string[];
  rows: Row[];
  map: ColumnMap;
  /** Index of an existing "Remarks" column in the source file, or -1. */
  remarksCol: number;
};

export type Item = {
  id: string;
  group: string;
  code: string;
  name: string;
  brand: string;
  remarks: Remark;
};

export function toRemark(value: string | undefined): Remark | null {
  const v = (value ?? "").trim().toLowerCase();
  return (REMARKS as readonly string[]).includes(v) ? (v as Remark) : null;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

/** Guess which columns hold item code, item name, and brand. -1 = not found. */
export function detectColumns(headers: string[]): ColumnMap {
  const h = headers.map(norm);
  const used = new Set<number>();
  const find = (tests: RegExp[]) => {
    for (const t of tests) {
      const i = h.findIndex((x, idx) => !used.has(idx) && t.test(x));
      if (i >= 0) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };
  const brand = find([/^brand( name)?$/, /brand/]);
  const code = find([
    /^item code$/,
    /^(sku|item no|item #|item number|material code|article code|product code)$/,
    /\bcode\b/,
    /\bsku\b/,
  ]);
  const name = find([
    /^item name$/,
    /^(item description|description|product name|item|product|name)$/,
    /description|desc\b/,
    /\bname\b/,
  ]);
  return { code, name, brand };
}

export function findRemarksCol(headers: string[]): number {
  return headers.findIndex((x) => /^remarks?$/.test(norm(x)));
}

export function toItems(sheets: Sheet[]): Item[] {
  const at = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
  return sheets.flatMap((s) =>
    s.rows.map((r) => ({
      id: r.id,
      group: s.name,
      code: at(r.cells, s.map.code),
      name: at(r.cells, s.map.name),
      brand: at(r.cells, s.map.brand),
      remarks: r.remarks,
    })),
  );
}

export const codeKey = (code: string) => code.trim().toUpperCase();

/** Item name compared case-insensitively, ignoring punctuation and word order. */
export const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");

export type DecisionRow = {
  code: string;
  name: string;
  brand: string;
  groups: string[];
  count: number;
};

/**
 * One row per item code across all bus groups, skipping inactive rows.
 * The first active/same occurrence supplies name and brand.
 */
export function buildDecision(items: Item[]): DecisionRow[] {
  const byCode = new Map<string, DecisionRow>();
  for (const it of items) {
    if (it.remarks === "inactive") continue;
    const key = codeKey(it.code);
    if (!key) continue;
    const existing = byCode.get(key);
    if (existing) {
      existing.count++;
      if (!existing.groups.includes(it.group)) existing.groups.push(it.group);
    } else {
      byCode.set(key, { code: it.code, name: it.name, brand: it.brand, groups: [it.group], count: 1 });
    }
  }
  return [...byCode.values()];
}

/** Items whose remarks are "active" (= new). */
export const buildNewItems = (items: Item[]) => items.filter((it) => it.remarks === "active");

export type DuplicateRow = Item & { dupId: number; matchOn: string };

/**
 * Groups items that share an item code, or an item name (word order ignored),
 * regardless of brand. Items are linked transitively.
 */
export function buildDuplicates(items: Item[]): DuplicateRow[] {
  const parent = items.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a: number, b: number) => {
    parent[root(a)] = root(b);
  };

  const codeIdx = new Map<string, number[]>();
  const nameIdx = new Map<string, number[]>();
  items.forEach((it, i) => {
    const c = codeKey(it.code);
    const n = nameKey(it.name);
    if (c) codeIdx.set(c, [...(codeIdx.get(c) ?? []), i]);
    if (n) nameIdx.set(n, [...(nameIdx.get(n) ?? []), i]);
  });
  for (const list of [...codeIdx.values(), ...nameIdx.values()]) {
    for (let k = 1; k < list.length; k++) join(list[0], list[k]);
  }

  const clusters = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = root(i);
    clusters.set(r, [...(clusters.get(r) ?? []), i]);
  });

  const out: DuplicateRow[] = [];
  let dupId = 0;
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    dupId++;
    for (const i of members) {
      const it = items[i];
      const sameCode = (codeIdx.get(codeKey(it.code))?.length ?? 0) > 1;
      const sameName = (nameIdx.get(nameKey(it.name))?.length ?? 0) > 1;
      const matchOn = [sameCode && "Item code", sameName && "Item name"].filter(Boolean).join(" + ");
      out.push({ ...it, dupId, matchOn });
    }
  }
  return out;
}

export type GroupTotal = { group: string; total: number } & Record<Remark, number>;

export function buildGroupTotals(sheets: Sheet[]): GroupTotal[] {
  return sheets.map((s) => {
    const t: GroupTotal = { group: s.name, total: s.rows.length, active: 0, same: 0, inactive: 0 };
    for (const r of s.rows) t[r.remarks]++;
    return t;
  });
}
