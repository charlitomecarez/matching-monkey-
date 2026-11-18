import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, DEBOUNCE_MS, SaverRegistry, type AutosaverOptions } from "./autosave";
import type { Sheet } from "./items";

type Result = { version: number } | { conflict: string };

const sheets = (tag: string): Sheet[] => [
  { name: tag, headers: [], rows: [], map: { code: -1, name: -1, brand: -1 }, remarksCol: -1 },
];

class Busy extends Error {}

/** A save function whose calls are resolved by hand. */
function controlledSave() {
  const calls: { sheets: Sheet[]; base: number; resolve: (r: Result) => void; reject: (e: unknown) => void }[] = [];
  const save = vi.fn(
    (state: { sheets: Sheet[] }, base: number) =>
      new Promise<Result>((resolve, reject) => calls.push({ sheets: state.sheets, base, resolve, reject })),
  );
  return { save, calls };
}

function makeSaver(save: AutosaverOptions["save"], id = "u1") {
  return new Autosaver({
    id,
    name: `${id}.xlsx`,
    fileName: `${id}.xlsx`,
    sheets: sheets("initial"),
    version: 1,
    save,
    busyRetryMs: (e) => (e instanceof Busy ? 30_000 : null),
    describeError: () => undefined,
  });
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Autosaver", () => {
  it("saves the latest sheets 1500 ms after the last change", async () => {
    const { save, calls } = controlledSave();
    const s = makeSaver(save);
    s.change(sheets("a"));
    await vi.advanceTimersByTimeAsync(1000);
    s.change(sheets("b"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    expect(s.view.status).toBe("saving");
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].sheets[0].name).toBe("b");
    expect(calls[0].base).toBe(1);
    calls[0].resolve({ version: 2 });
    await settle();
    expect(s.view.status).toBe("saved");
    expect(s.pending()).toBe(false);
  });

  it("keeps one save in flight and then saves the newest edits from the new version", async () => {
    const { save, calls } = controlledSave();
    const s = makeSaver(save);
    s.change(sheets("a"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.change(sheets("b"));
    s.change(sheets("c"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(calls).toHaveLength(1); // still in flight
    calls[0].resolve({ version: 2 });
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1].sheets[0].name).toBe("c");
    expect(calls[1].base).toBe(2);
    calls[1].resolve({ version: 3 });
    await settle();
    expect(s.view.status).toBe("saved");
  });

  it("retries errors with backoff and keeps the edits", async () => {
    const { save, calls } = controlledSave();
    const s = makeSaver(save);
    s.change(sheets("a"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls[0].reject(new Error("offline"));
    await settle();
    expect(s.view.status).toBe("error");
    expect(s.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].sheets[0].name).toBe("a");
    calls[1].resolve({ version: 2 });
    await settle();
    expect(s.view.status).toBe("saved");
  });

  it("waits 30 s when another save is in progress", async () => {
    const { save, calls } = controlledSave();
    const s = makeSaver(save);
    s.change(sheets("a"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls[0].reject(new Busy());
    await settle();
    expect(s.view.status).toBe("saving");
    s.change(sheets("b")); // a new edit doesn't skip the wait
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[1].sheets[0].name).toBe("b");
  });

  it("stops autosaving after a conflict", async () => {
    const { save, calls } = controlledSave();
    const s = makeSaver(save);
    s.change(sheets("a"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls[0].resolve({ conflict: "changed elsewhere" });
    await settle();
    expect(s.view).toMatchObject({ status: "conflict", message: "changed elsewhere" });
    s.change(sheets("b"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(s.view.sheets[0].name).toBe("b");
  });
});

describe("SaverRegistry", () => {
  it("saves right away when the page is left and drops the saver once clean", async () => {
    const reg = new SaverRegistry();
    const { save, calls } = controlledSave();
    const s = makeSaver(save);
    reg.attach(s);
    s.change(sheets("a"));
    reg.release(s);
    await settle();
    expect(calls).toHaveLength(1); // no debounce wait
    expect(reg.anyPending()).toBe(true);
    expect(reg.get("u1")).toBe(s); // reopening reuses the latest sheets and version
    expect(reg.get("u1")?.view.sheets[0].name).toBe("a");
    calls[0].resolve({ version: 2 });
    await settle();
    expect(reg.anyPending()).toBe(false);
    expect(reg.get("u1")).toBeUndefined();
  });

  it("keeps an attached saver even when clean", () => {
    const reg = new SaverRegistry();
    const s = makeSaver(controlledSave().save);
    reg.attach(s);
    expect(reg.get("u1")).toBe(s);
    reg.release(s);
    expect(reg.get("u1")).toBeUndefined();
  });

  it("reports errors and conflicts of detached savers until they recover or are reopened", async () => {
    const reg = new SaverRegistry();
    const a = controlledSave();
    const b = controlledSave();
    const sa = makeSaver(a.save, "a");
    const sb = makeSaver(b.save, "b");
    reg.attach(sa);
    reg.attach(sb);
    sa.change(sheets("x"));
    sb.change(sheets("y"));
    reg.release(sa);
    reg.release(sb);
    await settle();
    expect(reg.problems()).toEqual([]);

    a.calls[0].reject(new Error("offline"));
    b.calls[0].resolve({ conflict: "changed elsewhere" });
    await settle();
    const first = reg.problems();
    expect(first).toEqual([
      { id: "a", name: "a.xlsx", status: "error" },
      { id: "b", name: "b.xlsx", status: "conflict" },
    ]);
    expect(reg.anyPending()).toBe(true);

    reg.attach(sb); // reopened: shown on its page instead
    expect(reg.problems()).toEqual([{ id: "a", name: "a.xlsx", status: "error" }]);

    await vi.advanceTimersByTimeAsync(2_000);
    a.calls[1].resolve({ version: 2 });
    await settle();
    expect(reg.problems()).toEqual([]);
    expect(reg.get("a")).toBeUndefined();
  });

  it("returns the same problems array while nothing changed", async () => {
    const reg = new SaverRegistry();
    const { save, calls } = controlledSave();
    const s = makeSaver(save);
    reg.attach(s);
    s.change(sheets("a"));
    reg.release(s);
    await settle();
    calls[0].reject(new Error("offline"));
    await settle();
    const p = reg.problems();
    s.change(sheets("b"));
    expect(reg.problems()).toBe(p);
  });
});
