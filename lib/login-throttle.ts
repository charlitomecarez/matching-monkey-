// Per-email login throttle, stored in the user's Appwrite prefs. Pure; the login action reads and
// writes the prefs with the API key (API-key requests skip Appwrite's own per-IP rate limits).

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOCKED_OUT_MESSAGE = "Too many attempts. Try again in a few minutes.";

export type ThrottlePrefs = { loginFailures: number; loginWindowStart: string };

function read(prefs: Record<string, unknown>): { failures: number; start: number } {
  const f = prefs.loginFailures;
  const failures = typeof f === "number" && Number.isInteger(f) && f > 0 ? f : 0;
  const s = prefs.loginWindowStart;
  const start = typeof s === "string" ? Date.parse(s) : Number.NaN;
  return { failures, start };
}

/** The current window (started at `start`) is still open at `now`. */
const inWindow = (start: number, now: number) => !Number.isNaN(start) && now - start < LOGIN_WINDOW_MS;

/** Too many failures inside the current window: refuse without checking the password. */
export function isLockedOut(prefs: Record<string, unknown>, now: number): boolean {
  const { failures, start } = read(prefs);
  return failures >= LOGIN_MAX_FAILURES && inWindow(start, now);
}

/** The throttle fields to merge into the prefs after a login attempt. */
export function nextThrottle(
  prefs: Record<string, unknown>,
  now: number,
  outcome: "success" | "failure",
): ThrottlePrefs {
  if (outcome === "success") return { loginFailures: 0, loginWindowStart: "" };
  const { failures, start } = read(prefs);
  if (inWindow(start, now)) return { loginFailures: failures + 1, loginWindowStart: new Date(start).toISOString() };
  return { loginFailures: 1, loginWindowStart: new Date(now).toISOString() };
}
