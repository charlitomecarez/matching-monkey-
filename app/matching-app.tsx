"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  REMARKS,
  buildDecision,
  buildDuplicates,
  buildGroupTotals,
  buildNewItems,
  toItems,
  type ColumnMap,
  type GroupTotal,
  type Remark,
  type Sheet,
} from "@/lib/items";
import { readWorkbook, writeWorkbook } from "@/lib/excel";

const STORAGE_KEY = "matching-monkey:workbook:v1";
const PAGE_SIZE = 100;

type Saved = { fileName: string; sheets: Sheet[] };

export default function MatchingApp() {
  const [data, setData] = useState<Saved | null>(null);
  const [tab, setTab] = useState("Dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore last session (browser only; ignore storage failures).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setData(JSON.parse(raw) as Saved);
    } catch {}
  }, []);
  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }, [data]);

  const sheets = useMemo(() => data?.sheets ?? [], [data]);
  const items = useMemo(() => toItems(sheets), [sheets]);
  const decision = useMemo(() => buildDecision(items), [items]);
  const newItems = useMemo(() => buildNewItems(items), [items]);
  const duplicates = useMemo(() => buildDuplicates(items), [items]);
  const totals = useMemo(() => buildGroupTotals(sheets), [sheets]);

  async function onUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const parsed = await readWorkbook(file);
      if (!parsed.length) throw new Error("No sheets with data were found in this file.");
      setData({ fileName: file.name, sheets: parsed });
      setTab("Dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    if (!data) return;
    setBusy(true);
    try {
      const blob = await writeWorkbook(data.sheets);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.fileName.replace(/\.xlsx?$/i, "") + " - matched.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const updateSheet = (name: string, fn: (s: Sheet) => Sheet) =>
    setData((d) => d && { ...d, sheets: d.sheets.map((s) => (s.name === name ? fn(s) : s)) });

  const setRemark = (id: string, remarks: Remark) =>
    setData(
      (d) =>
        d && {
          ...d,
          sheets: d.sheets.map((s) =>
            s.rows.some((r) => r.id === id)
              ? { ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, remarks } : r)) }
              : s,
          ),
        },
    );

  const tabs = ["Dashboard", ...sheets.map((s) => s.name), "Decision", "New Items", "Duplication"];
  const counts: Record<string, number> = {
    Decision: decision.length,
    "New Items": newItems.length,
    Duplication: new Set(duplicates.map((d) => d.dupId)).size,
    ...Object.fromEntries(sheets.map((s) => [s.name, s.rows.length])),
  };
  const activeSheet = sheets.find((s) => s.name === tab);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Item Matching</h1>
          <p className="text-sm text-muted">
            {data ? data.fileName : "Upload an Excel workbook with one sheet per bus group."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="btn cursor-pointer">
            {data ? "Upload another file" : "Upload Excel"}
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.target.value = "";
              }}
            />
          </label>
          {data && (
            <button className="btn btn-primary" disabled={busy} onClick={onDownload}>
              Download .xlsx
            </button>
          )}
        </div>
      </header>

      {busy && <p className="mt-4 text-sm text-muted">Working…</p>}
      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {data && (
        <>
          <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sheets">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                  tab === t ? "border-accent font-medium" : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {t}
                {t in counts && <span className="ml-1.5 text-xs text-muted">{counts[t]}</span>}
              </button>
            ))}
          </nav>

          <div className="mt-5">
            {tab === "Dashboard" && (
              <Dashboard
                totals={totals}
                items={items}
                decisionCount={decision.length}
                newCount={newItems.length}
                dupCount={counts.Duplication}
                setRemark={setRemark}
              />
            )}
            {activeSheet && (
              <GroupSheet key={activeSheet.name} sheet={activeSheet} update={updateSheet} setRemark={setRemark} />
            )}
            {tab === "Decision" && (
              <>
                <Note>
                  Each item code appears once across all bus groups. Rows marked <b>inactive</b> are left out.
                </Note>
                <Table
                  headers={["Item Code", "Item Name", "Brand", "Bus Groups", "Occurrences"]}
                  rows={decision.map((d) => ({
                    key: d.code,
                    cells: [d.code, d.name, d.brand, d.groups.join(", "), d.count],
                  }))}
                />
              </>
            )}
            {tab === "New Items" && (
              <>
                <Note>
                  Items whose Remarks is <b>active</b>.
                </Note>
                <Table
                  headers={["Bus Group", "Item Code", "Item Name", "Brand", "Remarks"]}
                  rows={newItems.map((it) => ({
                    key: it.id,
                    cells: [it.group, it.code, it.name, it.brand, <RemarkSelect key="r" value={it.remarks} onChange={(v) => setRemark(it.id, v)} />],
                  }))}
                />
              </>
            )}
            {tab === "Duplication" && (
              <>
                <Note>
                  Items with the same item code, or the same item name in any word order, across all bus groups and
                  brands. Rows with the same Duplicate # belong together.
                </Note>
                <Table
                  headers={["Duplicate #", "Matched On", "Bus Group", "Item Code", "Item Name", "Brand", "Remarks"]}
                  rows={duplicates.map((d) => ({
                    key: d.id,
                    cells: [d.dupId, d.matchOn, d.group, d.code, d.name, d.brand, <RemarkSelect key="r" value={d.remarks} onChange={(v) => setRemark(d.id, v)} />],
                  }))}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-sm text-muted">{children}</p>;
}

function RemarkSelect({ value, onChange }: { value: Remark; onChange: (v: Remark) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Remark)}
      aria-label="Remarks"
      className={`field py-0.5 remark-${value}`}
    >
      {REMARKS.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

type TableRow = { key: string; cells: ReactNode[] };

function Table({ headers, rows }: { headers: string[]; rows: TableRow[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
            <tr>
              {headers.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-t border-line">
                {r.cells.map((c, i) => (
                  <td key={i} className="px-3 py-1.5 align-top">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={headers.length} className="px-3 py-6 text-center text-muted">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-sm text-muted">
          <span>
            {current * PAGE_SIZE + 1}–{Math.min(rows.length, (current + 1) * PAGE_SIZE)} of {rows.length}
          </span>
          <button className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Prev
          </button>
          <button className="btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function GroupSheet({
  sheet,
  update,
  setRemark,
}: {
  sheet: Sheet;
  update: (name: string, fn: (s: Sheet) => Sheet) => void;
  setRemark: (id: string, v: Remark) => void;
}) {
  const [bulk, setBulk] = useState<Remark>("same");
  const visibleCols = sheet.headers.map((_, i) => i).filter((i) => i !== sheet.remarksCol);
  const fields: { key: keyof ColumnMap; label: string }[] = [
    { key: "code", label: "Item code" },
    { key: "name", label: "Item name" },
    { key: "brand", label: "Brand" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-line bg-subtle p-3 text-sm">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{f.label} column</span>
            <select
              className="field"
              value={sheet.map[f.key]}
              onChange={(e) =>
                update(sheet.name, (s) => ({ ...s, map: { ...s.map, [f.key]: Number(e.target.value) } }))
              }
            >
              <option value={-1}>— none —</option>
              {visibleCols.map((i) => (
                <option key={i} value={i}>
                  {sheet.headers[i]}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="ml-auto flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Set every row in this sheet to</span>
            <select className="field" value={bulk} onChange={(e) => setBulk(e.target.value as Remark)}>
              {REMARKS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            onClick={() =>
              update(sheet.name, (s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, remarks: bulk })) }))
            }
          >
            Apply
          </button>
        </div>
      </div>
      {(sheet.map.code < 0 || sheet.map.name < 0) && (
        <Note>Pick the item code and item name columns above so this sheet is included in matching.</Note>
      )}
      <Table
        headers={[...visibleCols.map((i) => sheet.headers[i]), "Remarks"]}
        rows={sheet.rows.map((r) => ({
          key: r.id,
          cells: [
            ...visibleCols.map((i) => r.cells[i]),
            <RemarkSelect key="r" value={r.remarks} onChange={(v) => setRemark(r.id, v)} />,
          ],
        }))}
      />
    </div>
  );
}

function Dashboard({
  totals,
  items,
  decisionCount,
  newCount,
  dupCount,
  setRemark,
}: {
  totals: GroupTotal[];
  items: ReturnType<typeof toItems>;
  decisionCount: number;
  newCount: number;
  dupCount: number;
  setRemark: (id: string, v: Remark) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      q
        ? items.filter((it) =>
            [it.code, it.name, it.brand, it.group].some((v) => v.toLowerCase().includes(q)),
          )
        : [],
    [items, q],
  );

  const stats = [
    { label: "Total items", value: items.length },
    { label: "Decision (unique codes)", value: decisionCount },
    { label: "New items", value: newCount },
    { label: "Duplicate sets", value: dupCount },
  ];

  return (
    <div className="flex flex-col gap-6">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search item code, item name, brand, or bus group…"
        aria-label="Search items"
        className="field w-full px-4 py-2.5 text-base"
      />

      {q ? (
        <section>
          <h2 className="mb-2 text-sm font-medium">
            {results.length} result{results.length === 1 ? "" : "s"} for “{query.trim()}”
          </h2>
          <Table
            key={q}
            headers={["Bus Group", "Item Code", "Item Name", "Brand", "Remarks"]}
            rows={results.map((it) => ({
              key: it.id,
              cells: [it.group, it.code, it.name, it.brand, <RemarkSelect key="r" value={it.remarks} onChange={(v) => setRemark(it.id, v)} />],
            }))}
          />
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-lg border border-line p-4">
                <div className="text-xs text-muted">{s.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</div>
              </div>
            ))}
          </section>
          <GroupChart totals={totals} />
        </>
      )}
    </div>
  );
}

function GroupChart({ totals }: { totals: GroupTotal[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...totals.map((t) => t.total));
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Total items per bus group</h2>
        <button className="text-xs text-muted underline" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {showTable ? (
        <Table
          headers={["Bus Group", "Total", "Active", "Same", "Inactive"]}
          rows={totals.map((t) => ({ key: t.group, cells: [t.group, t.total, t.active, t.same, t.inactive] }))}
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {totals.map((t) => (
            <li
              key={t.group}
              className="relative grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 rounded py-1.5 hover:bg-subtle"
              onMouseEnter={() => setHover(t.group)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="truncate text-sm" title={t.group}>
                {t.group}
              </span>
              <div className="flex items-center gap-2">
                <div
                  className="h-4 rounded-r bg-bar"
                  style={{ width: `${(t.total / max) * 85}%`, minWidth: t.total ? 2 : 0 }}
                />
                <span className="text-sm tabular-nums text-muted">{t.total.toLocaleString()}</span>
              </div>
              {hover === t.group && (
                <div className="pointer-events-none absolute right-2 top-full z-10 mt-1 rounded-md border border-line bg-background px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium">{t.group}</div>
                  <div className="tabular-nums text-muted">
                    {t.total} total · {t.active} active · {t.same} same · {t.inactive} inactive
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
