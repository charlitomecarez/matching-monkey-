import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function run(path: string, cookie?: string) {
  const req = new NextRequest(`https://app.test${path}`, cookie ? { headers: { cookie } } : undefined);
  return proxy(req);
}

describe("proxy", () => {
  it("redirects to /login without a session cookie", () => {
    const res = run("/");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login");
  });

  it("lets requests with a session cookie through", () => {
    expect(run("/", "mm_session=abc").headers.get("location")).toBeNull();
  });

  it.each(["/login", "/invite", "/invite/accept", "/api/jwt", "/_next/static/x.js", "/favicon.ico", "/logo.svg"])(
    "leaves %s alone",
    (path) => {
      expect(run(path).headers.get("location")).toBeNull();
    },
  );

  it("does not treat /loginx or /apiary as public", () => {
    expect(run("/loginx").headers.get("location")).toBe("https://app.test/login");
    expect(run("/apiary").headers.get("location")).toBe("https://app.test/login");
  });
});
