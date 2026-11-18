// Autosave engine and the registry of savers that outlive the workbook page. No SDK imports: the
// save function is injected, so this is unit-testable with fake timers.
//
// A saver stays registered while it has unsaved edits or a save in flight, and while it is
// detached (its page was left) with an error or conflict to report. That lets the app warn on tab
// close, show background failures, and reuse the saver (latest sheets + version) when the same
// upload is reopened before its save finished.
import type { Sheet } from "./items";
import { retryDelayMs } from "./save-plan";
import type { WorkbookState } from "./state";

export const DEBOUNCE_MS = 1500;

export type SaveStatus = "saved" | "saving" | "error" | "conflict";

export type SaverView = { status: SaveStatus; message?: string; sheets: Sheet[] };

export type AutosaverOptions = {
  id: string;
  name: string;
  fileName: string;
  sheets: Sheet[];
  version: number;
  save: (state: WorkbookState, baseVersion: number) => Promise<{ version: number } | { conflict: string }>;
  /** ms to wait when the error means "another save is still in progress", else null. */
  busyRetryMs: (e: unknown) => number | null;
  /** Optional reason shown next to "Couldn't save — retrying". */
  describeError: (e: unknown) => string | undefined;
};

/**
 * Debounced autosave: one save in flight at a time, always saving the latest sheets. Errors retry
 * with backoff and keep the edits; a conflict stops autosaving.
 */
export class Autosaver {
  readonly id: string;
  readonly name: string;
  attached = false;
  view: SaverView;

  private readonly opts: AutosaverOptions;
  private latest: Sheet[];
  private saved: Sheet[];
  private version: number;
  private inFlight = false;
  private stopped = false;
  private failing = false;
  private failures = 0;
  private notBefore = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Called after every state change (the registry uses it to tidy up and notify). */
  onUpdate: (s: Autosaver) => void = () => {};

  constructor(opts: AutosaverOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.name = opts.name;
    this.latest = this.saved = opts.sheets;
    this.version = opts.version;
    this.view = { status: "saved", sheets: opts.sheets };
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Unsaved edits or a save in flight. */
  pending(): boolean {
    return this.latest !== this.saved || this.inFlight;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  change(sheets: Sheet[]): void {
    this.latest = sheets;
    if (this.stopped) return this.publish(this.view.status, this.view.message);
    this.publish(this.failing ? this.view.status : "saving", this.failing ? this.view.message : undefined);
    this.schedule(DEBOUNCE_MS);
  }

  /** Save now instead of waiting for the debounce (tab hidden, page left). Respects backoff. */
  flushNow(): void {
    if (this.stopped || !this.timer || Date.now() < this.notBefore) return;
    clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
  }

  private publish(status: SaveStatus, message?: string) {
    this.view = { status, message, sheets: this.latest };
    this.listeners.forEach((fn) => fn());
    this.onUpdate(this);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      Math.max(ms, this.notBefore - Date.now()),
    );
  }

  private retryLater(ms: number) {
    this.notBefore = Date.now() + ms;
    this.schedule(ms);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.inFlight || !this.pending()) return;
    this.inFlight = true;
    if (!this.failing) this.publish("saving");
    const snapshot = this.latest;
    let result: { version: number } | { conflict: string };
    try {
      result = await this.opts.save({ v: 1, fileName: this.opts.fileName, sheets: snapshot }, this.version);
    } catch (e) {
      this.inFlight = false;
      const busy = this.opts.busyRetryMs(e);
      if (busy !== null) {
        this.publish(this.failing ? "error" : "saving", this.failing ? this.view.message : undefined);
        this.retryLater(busy);
      } else {
        this.failing = true;
        this.failures += 1;
        this.retryLater(retryDelayMs(this.failures));
        this.publish("error", this.opts.describeError(e));
      }
      return;
    }
    this.inFlight = false;
    if ("conflict" in result) {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.publish("conflict", result.conflict);
      return;
    }
    this.version = result.version;
    this.saved = snapshot;
    this.failing = false;
    this.failures = 0;
    this.notBefore = 0;
    if (!this.pending()) this.publish("saved");
    else if (!this.timer) void this.flush(); // edits arrived while saving and their debounce already fired
    else this.publish("saving");
  }
}

export type BackgroundProblem = { id: string; name: string; status: "error" | "conflict" };

const NO_PROBLEMS: BackgroundProblem[] = [];

export class SaverRegistry {
  private readonly savers = new Map<string, Autosaver>();
  private readonly listeners = new Set<() => void>();
  private problemList: BackgroundProblem[] = NO_PROBLEMS;

  get(id: string): Autosaver | undefined {
    return this.savers.get(id);
  }

  /** Registers a saver and marks it as shown by a page. */
  attach(saver: Autosaver): void {
    saver.attached = true;
    saver.onUpdate = (s) => this.update(s);
    this.savers.set(saver.id, saver);
    this.update(saver);
  }

  /** The page showing this saver went away: save now; keep it only while it still matters. */
  release(saver: Autosaver): void {
    saver.attached = false;
    saver.flushNow();
    this.update(saver);
  }

  /** Any edit anywhere not saved yet (or a save in flight): warn before the tab closes. */
  anyPending(): boolean {
    for (const s of this.savers.values()) if (s.pending()) return true;
    return false;
  }

  flushAll(): void {
    for (const s of this.savers.values()) s.flushNow();
  }

  /** Detached savers that hit an error or a conflict. Stable reference between changes. */
  problems = (): BackgroundProblem[] => this.problemList;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private update(saver: Autosaver) {
    const { status } = saver.view;
    const problem = status === "error" || status === "conflict";
    if (!saver.attached && !saver.pending() && !problem && this.savers.get(saver.id) === saver) {
      this.savers.delete(saver.id);
    }
    const next = [...this.savers.values()]
      .filter((s) => !s.attached && (s.view.status === "error" || s.view.status === "conflict"))
      .map((s) => ({ id: s.id, name: s.name, status: s.view.status as BackgroundProblem["status"] }));
    const same =
      next.length === this.problemList.length &&
      next.every((p, i) => {
        const q = this.problemList[i];
        return p.id === q.id && p.name === q.name && p.status === q.status;
      });
    if (!same) this.problemList = next.length ? next : NO_PROBLEMS;
    this.listeners.forEach((fn) => fn());
  }
}

/** The app-wide registry (one per browser tab). */
export const savers = new SaverRegistry();

let guardInstalled = false;

/** One beforeunload warning and one page-hide flush for every registered saver. Idempotent. */
export function installUnloadGuard(registry: SaverRegistry = savers): void {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  window.addEventListener("beforeunload", (e) => {
    if (!registry.anyPending()) return;
    e.preventDefault();
    e.returnValue = ""; // older browsers need this to show the prompt
  });
  window.addEventListener("pagehide", () => registry.flushAll());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") registry.flushAll();
  });
}
