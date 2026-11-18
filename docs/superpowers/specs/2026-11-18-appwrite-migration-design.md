# Item Matching — Appwrite + Vercel migration

Date: 2026-11-18

## Intent

Item Matching is a Next.js app (currently browser-only) where a user uploads an Excel workbook with
one sheet per bus group, sets a Remarks value per row (active / same / inactive), and gets derived
Decision, New Items, Duplication and Dashboard views plus a downloadable .xlsx.

Today all state lives in one browser's `localStorage`. The migration puts the app behind a login and
saves each person's work to their own account so it follows them across computers, keeps a history
of their uploads, and restricts access to people an admin has invited.

## Decided by the owner

- **Hosting:** Vercel hosts the Next.js site.
- **Backend:** Appwrite provides authentication, database and file storage.
- **Data is private per account.** No sharing between accounts, no team workspaces. Nobody, admins
  included, sees another person's uploads or Remarks.
- **Upload history.** Each upload is kept as its own entry; the user can reopen any past upload and
  continue where they left off.
- **Invite-only.** There is no public sign-up.
- **Invites are sent from an Admin page inside the app.**
- **Admins:** the owner is the first admin; an admin can make another user an admin.
- **Appwrite instance:** Appwrite Cloud. The project does not exist yet, so the plan includes the
  owner creating the Cloud project (console steps), plus a setup script that creates the database,
  collection, attributes and buckets. Check the Cloud plan's limits (file size, sign-up controls,
  invite emails) against this design.

## Goals

1. Login with email + password (Appwrite Auth). Logged-out visitors only see the login screen.
2. Upload list per user: file name, upload date, open, rename, delete.
3. Opening an upload restores its sheets, column mappings and every Remarks edit.
4. Remarks edits and column-mapping changes autosave to the open upload.
5. The original uploaded .xlsx is stored and can be re-downloaded unchanged; "Download .xlsx" (the
   generated workbook with Remarks + Decision / New Items / Duplication / Dashboard) works as today.
6. Admin page (admins only): invite by email, list users with status (invited / joined), revoke
   access, grant/remove admin.
7. Access is enforced server-side, not only by hiding UI: an account that was not invited (or whose
   access was revoked) cannot read or write any data even if it obtains a session.
8. Deployed on Vercel against an Appwrite project.

## Non-goals

- Sharing uploads or Remarks between users; team workspaces.
- Admins viewing or editing other users' data.
- OAuth / social login (email + password only for now).
- Changing the matching rules (Decision / New Items / Duplication) — `lib/items.ts` logic is kept.

## Anti-goals (would count as failure even if it "works")

- Anyone on the internet can create an account and use the app.
- One user can see another user's uploads by guessing an ID.
- The Appwrite API key reaches the browser.
- A Remarks edit is silently lost (e.g. closing the tab right after an edit with no save).

## Constraints

- Next.js 16.4 App Router with `cacheComponents` enabled. Per `AGENTS.md`, read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next code (auth/cookies, route handlers, server
  actions, `proxy.ts` replaces `middleware.ts`).
- Verify all Appwrite APIs against current Appwrite docs; do not rely on memory.
- Workbooks can have thousands of rows across many sheets; the design must not require one database
  write per row edit or exceed Appwrite document size limits.
- Excel parsing/writing stays client-side with `exceljs` (`lib/excel.ts`).
- Secrets (Appwrite API key) live only in Vercel / `.env.local` server env vars.

## Current code to build on

- `lib/items.ts` — types (`Sheet`, `Row`, `Remark`), column detection, derived sheets. Pure; keep.
- `lib/excel.ts` — `readWorkbook(file)` / `writeWorkbook(sheets)`. Keep.
- `app/matching-app.tsx` — the whole UI as one client component; persistence is the two
  `localStorage` effects. Replace persistence with the account-backed store; add upload list.

## Proposed shape (builder may adjust; marked calls are mine, not the owner's)

**Auth & sessions (my call):** Appwrite SSR pattern — server-side login route creates the session with
`node-appwrite` and stores the session secret in an httpOnly cookie; server code makes Appwrite calls
as the user via that session. `proxy.ts` redirects unauthenticated requests to `/login`.

**Who is allowed in (my call, revised after checking node-appwrite 31.3):** one Appwrite Team,
`members`. A confirmed membership = allowed in; team role `owner` = admin (Appwrite only lets owners
invite and change roles, so the platform enforces it too). Every server route checks confirmed
membership. Rows/files are permitted to `Role.user(<id>)`; create permission on the table and buckets
is `Role.team("members")`, so a self-signed-up stranger cannot write anything. Public sign-up can't be
fully switched off without blocking invites, so the membership check is the gate.

**Invite flow (verified against SDK docs):** the Admin page calls a server action that runs
`teams.createMembership` **as the admin's own session** (not the API key — with an API key Appwrite
adds the member silently and sends no email). Appwrite emails a link to `/invite?...`; that page asks
for a password, confirms the membership with `teams.updateMembershipStatus`, sets the password with the
API key (`users.updatePassword`), and signs them in. Revoke = delete the membership and the user's
sessions. Make admin = set roles to `["owner"]`. Bootstrap: the setup script creates the owner's
account and adds it to `members` as `owner` using the API key.

**Data (my call):**
- Table `uploads` (Appwrite TablesDB — "collections/documents" are deprecated since Appwrite 1.8):
  `ownerId`, `name`, `originalFileId`, `stateFileId`, `version`, `rowCount`, `sheetCount`
  (`$createdAt`/`$updatedAt` are built in). Row permissions: owner only.
- Storage bucket `originals`: the uploaded .xlsx as-is.
- Storage bucket `states`: the parsed `Sheet[]` JSON (headers, rows, column maps, remarks). Saved with a
  debounce (~1–2 s) after edits, replacing the previous state file, plus a flush on page hide. Show a
  "Saving… / Saved" indicator.
- Parsing happens in the browser as now.
- **File transfer (my call):** Vercel functions cap request bodies at ~4.5 MB, so the browser uploads
  the original .xlsx and the state JSON straight to Appwrite Storage using a short-lived Appwrite JWT
  issued by the server for the logged-in, allowed user. Bucket/file permissions still restrict each
  file to its owner. Server routes handle only small metadata calls.
- **Unsaved edits (my call):** while a save is pending, warn on tab close (`beforeunload`) rather than
  relying on `sendBeacon` (too small for state files).
- **Two tabs / devices on one upload (my call):** each `uploads` document carries a `version` number.
  A save sends the version it started from; if the stored version is newer, the save is refused and the
  user sees "This upload was changed in another tab or device — reload to continue." No silent
  last-write-wins.

**Revoking & admin guardrails (my calls):**
- Revoking access keeps the user's data; re-inviting the same email restores it. Permanent deletion
  of a user and their data is a separate, confirmed admin action.
- An admin cannot revoke or demote themselves, and the last remaining admin cannot be removed.

**Privacy scope (my call):** "admins don't see other users' data" applies to the app. Anyone with
Appwrite console or API-key access can technically read stored data; no client-side encryption.

**Existing local data (my call):** on first login, if `localStorage` holds a workbook from the old
version, offer to save it as an upload in the account, then clear it.

## Left to the builder

- Exact Appwrite invite mechanism and whether sign-up can be disabled at the project level.
- Server actions vs route handlers for the Appwrite calls.
- Upload list layout and where it sits relative to the existing tabs.
- Env var names, Appwrite project/database/bucket IDs, and a setup script or README steps for creating
  collections/buckets/attributes.
- Vercel deployment config (env vars, domain allowed as an Appwrite web platform).
