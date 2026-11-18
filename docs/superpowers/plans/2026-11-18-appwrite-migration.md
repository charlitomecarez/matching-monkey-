# Appwrite + Vercel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Item Matching behind an invite-only Appwrite login, save each user's uploads (original .xlsx + editable state) privately in Appwrite, and add an in-app Admin page, deployable on Vercel.

**Architecture:** Next.js 16 App Router on Vercel. Server code talks to Appwrite with `node-appwrite` (API-key "admin" client, or a per-user "session" client built from an httpOnly cookie). Large files skip Vercel: the browser uploads/downloads them straight to Appwrite Storage with the `appwrite` web SDK using a short-lived JWT from our server. Access = confirmed membership in Appwrite Team `members`; admin = team role `owner`.

**Tech Stack:** Next.js 16.4 (`cacheComponents`, `proxy.ts`), React 19.3, `node-appwrite@31.3.0`, `appwrite@29.3.1`, `exceljs` (existing), Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-18-appwrite-migration-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (`AGENTS.md`). In particular `01-app/02-guides/authentication-with-cache-components.md`: any component that reads `cookies()` must render inside `<Suspense>`; `proxy.ts` (not `middleware.ts`) does only an optimistic cookie-presence redirect.
- Use `TablesDB` / rows APIs, never the deprecated `Databases` / documents APIs.
- `APPWRITE_API_KEY` is server-only. Never import `lib/appwrite/server.ts` from a client component (add `import "server-only"` at its top).
- Every route handler / server action that touches user data calls `requireMember()` first. Never trust an `ownerId` sent by the browser.
- No request body to a Vercel route may carry workbook contents (4.5 MB cap); only IDs and small metadata.
- Env vars (exact names): `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APP_URL`.
- Appwrite IDs (exact, in `lib/appwrite/config.ts`): database `matching`, table `uploads`, buckets `originals` and `states`, team `members`, session cookie `mm_session`.
- Remarks rules, Decision/New Items/Duplication logic in `lib/items.ts` stay unchanged.

## Review Focus

1. **A logged-in non-member** (self-signed-up via the raw Appwrite API, or revoked) — every data route returns 403 and the UI shows "You don't have access"; test in Task 3 (`requireMember` rejects unconfirmed / missing membership).
2. **Another user's upload ID in the URL** — 404, never their data; test in Task 5 (`assertOwner`).
3. **Save after the same upload changed in another tab** — 409 and the "changed in another tab or device — reload" message; the new state file is deleted, the stored row is untouched; test in Task 5 (`decideCommit`).
4. **Removing yourself or the last admin** — refused with a clear message; test in Task 4 (`checkAdminChange`).
5. **Re-uploading a workbook this app exported** (has Dashboard/Decision/... sheets and a Remarks column) — generated sheets skipped, Remarks restored; test in Task 1 (`readWorkbook` round-trip).

---

### Task 1: Test harness and lock current behaviour

**Files:**
- Modify: `package.json` (add `vitest` dev dep, `"test": "vitest run"`)
- Create: `vitest.config.ts` (node env, `@` alias → repo root)
- Test: `lib/items.test.ts`, `lib/excel.test.ts`

**Interfaces:**
- Consumes: existing `lib/items.ts`, `lib/excel.ts`
- Produces: `npm test` runs all `*.test.ts`

- [ ] **Step 1: Install** `npm i -D vitest` and add config + script.
- [ ] **Step 2: Write tests for current behaviour** (they should pass immediately — they guard the refactors later):
  - `buildDecision` drops inactive rows and dedupes `"A001"`/`"a001 "` into one row with `count: 2`.
  - `nameKey("150g Corned-Beef") === nameKey("corned beef 150G")`.
  - `buildDuplicates` puts `A001/Purefoods`, `a001/Argentina`, `C300 "150g corned beef"/CDO` in one `dupId`; `C300.matchOn === "Item name"`.
  - `detectColumns(["SKU","Description","Brand Name","Remarks"])` → `{code:0,name:1,brand:2}`; `findRemarksCol` → 3.
  - Round-trip (Review Focus 5): build a workbook in-test with exceljs (title row, blank row, header row on row 3; second sheet with Remarks `inactive`/`same`/`weird`), `readWorkbook` → `writeWorkbook` → `readWorkbook` again; assert sheet names exclude `Dashboard`/`Decision`/`New Items`/`Duplication` and remarks are `["inactive","same","active"]`. `readWorkbook` takes a `File`; pass `{ name, arrayBuffer: async () => buf } as File`.
- [ ] **Step 3: Run** `npm test` → all PASS.
- [ ] **Step 4: Commit** `test: cover matching rules and workbook round-trip`

### Task 2: Appwrite config, clients, setup script, docs

**Files:**
- Create: `lib/appwrite/config.ts`, `lib/appwrite/server.ts`, `lib/appwrite/browser.ts`, `scripts/setup-appwrite.mjs`, `.env.example`
- Modify: `README.md` (replace starter text with setup + deploy steps)

**Interfaces:**
- Produces:
  - `config.ts`: `export const IDS = { database: "matching", uploads: "uploads", originals: "originals", states: "states", team: "members" } as const; export const SESSION_COOKIE = "mm_session"; export const ENDPOINT, PROJECT_ID` (from `NEXT_PUBLIC_*`).
  - `server.ts` (`server-only`): `createAdminClient(): { account, users, teams, tables, storage }` (API key); `createSessionClient(secret: string): { account, teams, tables, storage }`; `createPublicClient(): { teams }` (project only, no key, no session — for accepting invites).
  - `browser.ts`: `getBrowserStorage(jwt: string): Storage` (web SDK `Client().setEndpoint().setProject().setJWT(jwt)`).

- [ ] **Step 1: Install** `npm i node-appwrite@31.3.0 appwrite@29.3.1 server-only`.
- [ ] **Step 2: Write config + clients** as above.
- [ ] **Step 3: Write `scripts/setup-appwrite.mjs`** — idempotent (catch 409 "already exists"), reads `.env.local` via `node --env-file=.env.local`. Creates:
  - database `matching`; table `uploads` with `rowSecurity: true`, table permissions `[Permission.create(Role.team("members"))]`; columns `ownerId` varchar 36 req, `name` varchar 255 req, `originalFileId` varchar 36 req, `stateFileId` varchar 36 req, `version` integer req, `rowCount` integer req, `sheetCount` integer req; key index on `ownerId`.
  - buckets `originals` and `states`: `fileSecurity: true`, permissions `[Permission.create(Role.team("members"))]`, `maximumFileSize` 50 MB (lower it if the Cloud plan rejects), extensions `["xlsx"]` / `["json"]`.
  - team `members`.
  - owner bootstrap from env `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME`: `users.create` (skip if exists, look up by email) then `teams.createMembership({ teamId: "members", roles: ["owner"], userId })` with the API key (auto-confirmed).
- [ ] **Step 4: README** — sections: *Create the Appwrite Cloud project* (console: new project; API key with scopes `users.read/write`, `teams.read/write`, `databases.read/write`, `tables.read/write`, `rows.read/write`, `buckets.read/write`, `files.read/write`, `sessions.write`; add Web platforms for `localhost` and the Vercel domain — required for invite redirect URLs and browser SDK CORS); *Run setup* (`cp .env.example .env.local`, fill, `node --env-file=.env.local scripts/setup-appwrite.mjs`); *Deploy to Vercel* (set the four env vars; set `APP_URL` to the production URL).
- [ ] **Step 5: Verify** `npx tsc --noEmit` passes. Script run against a real project is a manual check listed in Task 8.
- [ ] **Step 6: Commit** `feat: appwrite clients, setup script and docs`

### Task 3: Login, session, member gate

**Files:**
- Create: `lib/auth.ts`, `lib/access.ts`, `app/login/page.tsx`, `app/login/actions.ts`, `proxy.ts`
- Test: `lib/access.test.ts`

**Interfaces:**
- Consumes: Task 2 clients, `IDS`, `SESSION_COOKIE`
- Produces:
  - `lib/access.ts` (pure): `type Membership = { $id: string; userId: string; teamId: string; roles: string[]; confirm: boolean }`; `memberStatus(memberships: Membership[], teamId: string): { member: boolean; admin: boolean; membershipId: string | null }` — member only if a membership for `teamId` has `confirm === true`; admin if also `roles.includes("owner")`.
  - `lib/auth.ts` (`server-only`): `type CurrentUser = { id: string; email: string; name: string; admin: boolean; membershipId: string; secret: string }`; `getCurrentUser(): Promise<CurrentUser | null>` (reads cookie, `account.get()` via session client, `users.listMemberships(id)` via admin client, `memberStatus`; null if no cookie/invalid session/not member); `requireMember(): Promise<CurrentUser>` throws `AuthError(401|403)`; `requireAdmin()` same + admin; `setSessionCookie(secret, expire)`, `clearSessionCookie()` (httpOnly, secure in prod, sameSite lax, path `/`).
  - `app/login/actions.ts`: `login(prev, formData)` → admin `account.createEmailPasswordSession(email, password)`; if `getCurrentUser` would deny (non-member) delete that session and return `{ error: "This account has not been invited." }`; else set cookie and `redirect("/")`. `logout()` → session client `account.deleteSession("current")`, clear cookie, redirect `/login`.
  - `proxy.ts`: if no `mm_session` cookie and path not in `/login`, `/invite`, `/_next/*`, `/favicon.ico` → redirect `/login`.

- [ ] **Step 1: Failing tests** for `memberStatus`: unconfirmed → `{member:false}`; other team only → `{member:false}`; confirmed `roles:[]` → `{member:true, admin:false}`; confirmed `["owner"]` → admin true.
- [ ] **Step 2: Run** `npm test` → FAIL (module missing).
- [ ] **Step 3: Implement** `lib/access.ts`, then `lib/auth.ts`, login page (email, password, error text, `useActionState`), actions, `proxy.ts`.
- [ ] **Step 4: Run** `npm test` → PASS; `npx next build` → succeeds (no "cookies() outside Suspense" error).
- [ ] **Step 5: Commit** `feat: invite-only login with appwrite sessions`

### Task 4: Invites and Admin page

**Files:**
- Create: `lib/admin-rules.ts`, `app/admin/page.tsx`, `app/admin/actions.ts`, `app/admin/members-table.tsx` (client), `app/invite/page.tsx`, `app/invite/actions.ts`
- Test: `lib/admin-rules.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `requireMember`, clients, `memberStatus`
- Produces:
  - `lib/admin-rules.ts` (pure): `type AdminChange = "revoke" | "demote" | "promote" | "delete"`; `checkAdminChange(actorUserId: string, target: Membership, all: Membership[], change: AdminChange): string | null` — returns an error message or null. Rules: actor cannot revoke/demote/delete themselves (`"You can't change your own access."`); demote/revoke/delete of an owner refused if they are the only confirmed owner (`"There must be at least one admin."`).
  - `app/admin/actions.ts` (each starts with `requireAdmin()`):
    - `inviteMember(email: string)` → **session** client `teams.createMembership({ teamId: IDS.team, roles: [], email, url: `${APP_URL}/invite` })` (session, not API key, so Appwrite sends the email).
    - `revokeMember(membershipId)` → `checkAdminChange`, admin `teams.deleteMembership`, admin `users.deleteSessions(userId)`. Data is kept.
    - `setAdmin(membershipId, admin: boolean)` → `checkAdminChange`, session `teams.updateMembership(team, id, admin ? ["owner"] : [])`.
    - `deleteUserAndData(userId)` → `checkAdminChange("delete")`, delete all `uploads` rows with `Query.equal("ownerId", userId)` and their two files (admin client), then `users.delete(userId)`.
    - `listMembers()` → admin `teams.listMemberships(IDS.team)` mapped to `{ membershipId, userId, email, name, status: confirm ? "joined" : "invited", admin }`.
  - `app/admin/page.tsx`: server component; `requireAdmin` inside `<Suspense>`; non-admins see "Admins only." Invite form + table with Revoke, Make admin / Remove admin, Delete user (delete asks for confirmation by typing the email — no `window.confirm`).
  - `app/invite/page.tsx` + `acceptInvite(prev, formData)`: reads `userId, membershipId, secret, teamId` from search params into hidden inputs; form takes password (min 8) + confirm. Action: `createPublicClient().teams.updateMembershipStatus(teamId, membershipId, userId, secret)` (fails → `"This invite link is invalid or was already used."`), then admin `users.updatePassword(userId, password)`, admin `users.createSession(userId)` → `setSessionCookie`, redirect `/`.

- [ ] **Step 1: Failing tests** for `checkAdminChange`: self revoke → message; demote only owner → `"There must be at least one admin."`; demote one of two owners → null; promote anyone → null; delete self → message.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** rules, actions, admin page, invite page. Add an "Admin" link in the header for admins only.
- [ ] **Step 4: Run** `npm test` → PASS; `npx next build` → succeeds.
- [ ] **Step 5: Commit** `feat: admin page with email invites and access management`

### Task 5: Uploads API (metadata, ownership, versioned saves)

**Files:**
- Create: `lib/uploads.ts` (pure), `lib/uploads-server.ts` (`server-only`), `app/api/jwt/route.ts`, `app/api/uploads/route.ts`, `app/api/uploads/[id]/route.ts`, `app/api/uploads/[id]/commit/route.ts`
- Test: `lib/uploads.test.ts`

**Interfaces:**
- Consumes: `requireMember`, clients, `IDS`
- Produces:
  - `lib/uploads.ts`: `type UploadMeta = { id: string; name: string; createdAt: string; updatedAt: string; originalFileId: string; stateFileId: string; version: number; rowCount: number; sheetCount: number }`; `assertOwner(row: { ownerId: string }, userId: string): void` (throws `NotFound`); `decideCommit(current: { version: number; stateFileId: string }, baseVersion: number, newStateFileId: string): { ok: true; nextVersion: number; deleteFileId: string } | { ok: false; deleteFileId: string }` — ok only when `baseVersion === current.version`; on ok delete the old state file, on conflict delete the new one.
  - Route handlers (JSON; all call `requireMember()`, map `AuthError` → 401/403, `NotFound` → 404):
    - `GET /api/jwt` → `{ jwt }` from session `account.createJWT()`.
    - `GET /api/uploads` → `UploadMeta[]` for `ownerId = user.id`, newest first.
    - `POST /api/uploads` body `{ name, originalFileId, stateFileId, rowCount, sheetCount }` → createRow with `ownerId: user.id`, `version: 1`, permissions `read/update/delete(Role.user(user.id))`; also set the same permissions on both files via admin `storage.updateFile` (guards against a browser that uploaded with wrong permissions). Returns `UploadMeta`.
    - `PATCH /api/uploads/[id]` `{ name }` → rename (non-empty, ≤255).
    - `DELETE /api/uploads/[id]` → delete row + both files.
    - `POST /api/uploads/[id]/commit` `{ stateFileId, baseVersion }` → `assertOwner`, `decideCommit`, on ok `updateRow({ stateFileId, version: nextVersion })` then delete old file → `{ version }`; on conflict delete the new file → 409 `{ error: "This upload was changed in another tab or device — reload to continue." }`.

- [ ] **Step 1: Failing tests**: `decideCommit` matching version → `{ok:true,nextVersion:current+1,deleteFileId:old}`; stale → `{ok:false,deleteFileId:new}`; `assertOwner` mismatch throws `NotFound`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; `npx next build` → succeeds.
- [ ] **Step 5: Commit** `feat: per-user uploads api with versioned saves`

### Task 6: Upload list and workbook pages with autosave

**Files:**
- Create: `lib/state.ts`, `lib/upload-client.ts`, `app/uploads-list.tsx` (client), `app/uploads/[id]/page.tsx`, `app/uploads/[id]/workbook.tsx` (client)
- Modify: `app/page.tsx` (list page), `app/matching-app.tsx` (controlled, no storage), `app/layout.tsx` (header: user email, Admin link, Log out)
- Test: `lib/state.test.ts`

**Interfaces:**
- Consumes: Task 5 routes, `getBrowserStorage`, `readWorkbook`/`writeWorkbook`
- Produces:
  - `lib/state.ts`: `type WorkbookState = { v: 1; fileName: string; sheets: Sheet[] }`; `serializeState(s): string`; `parseState(text: string): WorkbookState` (throws on wrong `v` / shape).
  - `lib/upload-client.ts` (browser): `createUpload(file: File): Promise<UploadMeta>` (parse with `readWorkbook`; JWT; upload original to `originals` and state JSON to `states` with `ID.unique()`, permissions `Role.user(me)` read/update/delete; then `POST /api/uploads`); `loadState(meta): Promise<WorkbookState>`; `saveState(meta, state, baseVersion): Promise<{ version: number } | { conflict: string }>` (upload new state file → `POST commit`); `downloadOriginal(meta)`. Cache the JWT and refresh on 401 or after 10 min (JWTs last 15 min).
  - `MatchingApp` props: `{ fileName: string; sheets: Sheet[]; onChange: (sheets: Sheet[]) => void; saveStatus: "saved" | "saving" | "error" | "conflict"; saveMessage?: string; onDownloadOriginal: () => void }`. Remove both `localStorage` effects and the upload button (upload lives on the list page).
  - `workbook.tsx`: holds `sheets`, debounced save 1500 ms after the last change (one save in flight at a time; queue the latest), shows "Saving… / Saved / Couldn't save — retrying / conflict message with Reload button" (on conflict stop autosaving), `beforeunload` warning while a change is unsaved or a save is in flight.
  - List page: Upload Excel button, table of uploads (name, uploaded, last edited, rows) with Open, Rename (inline), Download original, Delete (inline confirm, no browser dialog). Empty state: "No uploads yet — upload an Excel workbook to start."

- [ ] **Step 1: Failing tests** for `parseState`: round-trips `serializeState`; rejects `{v:2}` and non-JSON.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; `npx next build` → succeeds.
- [ ] **Step 5: Commit** `feat: saved uploads with autosave and conflict detection`

### Task 7: Import the old browser-only workbook

**Files:**
- Create: `lib/legacy.ts`, `app/legacy-import.tsx` (client, rendered on list page)
- Test: `lib/legacy.test.ts`

**Interfaces:**
- Produces: `readLegacy(raw: string | null): WorkbookState | null` — parses the old `localStorage["matching-monkey:workbook:v1"]` shape `{ fileName, sheets }`; null for missing/invalid. Banner: "A workbook from the old version is saved in this browser: <fileName>. Save it to your account?" [Save] [Discard]. Save → `createUpload`-equivalent from state (no original file: upload a freshly generated `writeWorkbook(sheets)` as the original) then remove the key. All storage access in try/catch.

- [ ] **Step 1: Failing tests**: valid → state with `v:1`; `null`/garbage/missing `sheets` → null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: offer to import workbook saved by the old version`

### Task 8: End-to-end verification and deploy readiness

**Files:** none new (fixes only)

- [ ] **Step 1:** `npm test`, `npx eslint .`, `npx next build` all clean.
- [ ] **Step 2: Manual check against a real Appwrite Cloud project** (needs the owner's project + `.env.local`; if unavailable, stop and report it as not verified):
  1. Run setup script twice (second run reports "exists", no errors).
  2. Log in as owner → empty list. Upload a workbook → opens; change Remarks → "Saved"; reload → change persists.
  3. Open same upload in a second tab, edit both → second save shows the conflict message.
  4. Admin → invite a second email → email arrives → set password → logged in, sees an empty list (not the owner's uploads). Paste the owner's upload URL → 404.
  5. Revoke them → their next request is redirected/403. Try revoking yourself and demoting the only admin → refused messages.
  6. Create an account directly via the Appwrite API (not invited) → login says "This account has not been invited."
- [ ] **Step 3: Commit** any fixes `fix: issues found in end-to-end check`
