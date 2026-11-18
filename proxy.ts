import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/appwrite/config";

/**
 * Optimistic gate only: redirects to /login when the session cookie is absent.
 * Real checks (valid session, team membership) happen in lib/auth.ts.
 * /api/* is excluded: route handlers answer 401/403 JSON themselves.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/invite" ||
    pathname.startsWith("/invite/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\/[^/]+\.[^/]+$/.test(pathname) // static files, e.g. /logo.svg
  );
}

export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
