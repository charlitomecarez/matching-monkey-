import { describe, expect, it } from "vitest";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, isLockedOut, nextThrottle } from "./login-throttle";

const t0 = Date.parse("2026-11-18T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("nextThrottle", () => {
  it("starts a window on the first failure", () => {
    expect(nextThrottle({}, t0, "failure")).toEqual({ loginFailures: 1, loginWindowStart: iso(t0) });
  });

  it("counts failures inside the window and keeps its start", () => {
    const prefs = { loginFailures: 3, loginWindowStart: iso(t0) };
    expect(nextThrottle(prefs, t0 + LOGIN_WINDOW_MS - 1, "failure")).toEqual({
      loginFailures: 4,
      loginWindowStart: iso(t0),
    });
  });

  it("starts a new window once the old one has ended", () => {
    const prefs = { loginFailures: 9, loginWindowStart: iso(t0) };
    expect(nextThrottle(prefs, t0 + LOGIN_WINDOW_MS, "failure")).toEqual({
      loginFailures: 1,
      loginWindowStart: iso(t0 + LOGIN_WINDOW_MS),
    });
  });

  it("treats damaged prefs as no history", () => {
    expect(nextThrottle({ loginFailures: "x", loginWindowStart: "garbage" }, t0, "failure")).toEqual({
      loginFailures: 1,
      loginWindowStart: iso(t0),
    });
  });

  it("resets on success", () => {
    const prefs = { loginFailures: 7, loginWindowStart: iso(t0) };
    expect(nextThrottle(prefs, t0 + 1000, "success")).toEqual({ loginFailures: 0, loginWindowStart: "" });
  });
});

describe("isLockedOut", () => {
  const at = (failures: number) => ({ loginFailures: failures, loginWindowStart: iso(t0) });

  it("is not locked with no history", () => {
    expect(isLockedOut({}, t0)).toBe(false);
  });

  it("locks at the failure limit inside the window, not one below", () => {
    expect(isLockedOut(at(LOGIN_MAX_FAILURES - 1), t0 + 1000)).toBe(false);
    expect(isLockedOut(at(LOGIN_MAX_FAILURES), t0 + 1000)).toBe(true);
    expect(isLockedOut(at(LOGIN_MAX_FAILURES + 5), t0 + 1000)).toBe(true);
  });

  it("unlocks exactly when the window ends", () => {
    expect(isLockedOut(at(LOGIN_MAX_FAILURES), t0 + LOGIN_WINDOW_MS - 1)).toBe(true);
    expect(isLockedOut(at(LOGIN_MAX_FAILURES), t0 + LOGIN_WINDOW_MS)).toBe(false);
  });

  it("is not locked when the window start is unparseable", () => {
    expect(isLockedOut({ loginFailures: 50, loginWindowStart: "garbage" }, t0)).toBe(false);
  });

  it("limit is 10 failures in 15 minutes", () => {
    expect(LOGIN_MAX_FAILURES).toBe(10);
    expect(LOGIN_WINDOW_MS).toBe(15 * 60_000);
  });
});
