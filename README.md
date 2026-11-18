# Item Matching

Next.js app for matching items across uploaded workbooks. Access is invite-only: sign-in and per-user storage are provided by Appwrite Cloud, and the app is hosted on Vercel.

## Create the Appwrite Cloud project

1. In the Appwrite Cloud console, create a new project. Note the project ID and copy the **regional** API endpoint shown in the console (Settings / Overview), for example `https://<region>.cloud.appwrite.io/v1`. Use that exact value for `NEXT_PUBLIC_APPWRITE_ENDPOINT`.
2. Create an API key (Overview > Integrations > API keys) with every scope the setup script and the app use:
   `users.read`, `users.write`, `sessions.read`, `sessions.write`, `teams.read`, `teams.write`, `databases.read`, `databases.write`, `tables.read`, `tables.write`, `columns.read`, `columns.write`, `indexes.read`, `indexes.write`, `rows.read`, `rows.write`, `buckets.read`, `buckets.write`, `files.read`, `files.write`.
   If unsure (scope names change between Appwrite versions), select all scopes for this key. Keep it secret: it is only ever used on the server.
3. Add Web platforms for `localhost` and for your Vercel domain. This is required for invite redirect URLs and for browser SDK CORS.

Note on sign-up: Appwrite Cloud's console Auth settings cannot fully disable sign-up without also blocking invites. Team membership (the `members` team) is the real access gate; the app rejects signed-in users who are not members.

## Run setup

```bash
cp .env.example .env.local
# fill in the values, including OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME
node --env-file=.env.local scripts/setup-appwrite.mjs
```

The script is idempotent. It creates the `matching` database, the `uploads` table (no client permissions: only the server touches rows), the `originals` and `states` buckets (members may upload; each file is readable only by its owner), the `members` team, and the owner account with an owner membership. Re-running reports what already existed and re-applies the table and bucket settings. `OWNER_*` variables are used only by this script.

### After setup

Sign in to the app as `OWNER_EMAIL`, open **Admin**, and invite people by email. Invitees get an email from Appwrite, follow the link, and choose a password.

### Appwrite Cloud plan notes

- **File size limit:** the script sets each bucket's `maximumFileSize` to 50,000,000 bytes (Appwrite Cloud's maximum). The Free plan allows smaller files per upload; if the script or console rejects the value, lower `MAX` in `scripts/setup-appwrite.mjs` and re-run it. (Saved workbook state is stored gzip-compressed and capped at 5 MB regardless.)
- **Pausing:** Free projects may be paused after a period of inactivity. Reopen the project in the console to resume it.
- **Invite emails** are sent by Appwrite's default SMTP. For production, configure a custom SMTP server (Settings > SMTP) so invites come from your domain and are less likely to land in spam.

## Develop

```bash
npm run dev     # http://localhost:3000
npm test        # Vitest
```

## Deploy to Vercel

Set these environment variables in the Vercel project:

- `NEXT_PUBLIC_APPWRITE_ENDPOINT`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY` (server-only)
- `APP_URL`: the production URL, for example `https://your-app.vercel.app`

Make sure the production domain is added as a Web platform in the Appwrite project.

### Rate-limit sign-in

The login action already locks an email out for a few minutes after 10 failed attempts in 15 minutes. As an extra layer, add a Vercel Firewall rate-limit rule for `POST /login` (Project > Firewall > Rules), for example 20 requests per minute per IP.

## Live smoke checklist

Run these against the real Appwrite project before going live:

1. Run the setup script twice; the second run reports "existed"/"updated" and no errors.
2. Upload a workbook, edit it, reload: the edits are there.
3. Open the same upload in two tabs and edit both: one saves, the other shows the "changed in another tab" message.
4. Invite a new email from Admin; the invite email arrives; accepting it sets a password and signs in.
5. Revoke that user: they cannot sign in, and their old session / direct Appwrite calls (Storage download with their JWT) are refused.
6. Download an original (checks CORS for the `X-Appwrite-JWT` header from your domain).
7. Open an upload, edit, go back, then forward/back to it again: it reopens with the latest state, no false conflict.
8. With a workbook saved by the old (local) version in the browser, the legacy import banner appears and imports it.
