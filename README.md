# Item Matching

Next.js app for matching items across uploaded workbooks. Access is invite-only: sign-in and per-user storage are provided by Appwrite Cloud, and the app is hosted on Vercel.

## Create the Appwrite Cloud project

1. In the Appwrite Cloud console, create a new project. Note the project ID and the API endpoint (for example `https://cloud.appwrite.io/v1`).
2. Create an API key (Overview > Integrations > API keys) with these scopes:
   `users.read`, `users.write`, `teams.read`, `teams.write`, `databases.read`, `databases.write`, `tables.read`, `tables.write`, `rows.read`, `rows.write`, `buckets.read`, `buckets.write`, `files.read`, `files.write`, `sessions.write`.
3. Add Web platforms for `localhost` and for your Vercel domain. This is required for invite redirect URLs and for browser SDK CORS.

Note on sign-up: Appwrite Cloud's console Auth settings cannot fully disable sign-up without also blocking invites. Team membership (the `members` team) is the real access gate; the app rejects signed-in users who are not members.

## Run setup

```bash
cp .env.example .env.local
# fill in the values, including OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME
node --env-file=.env.local scripts/setup-appwrite.mjs
```

The script is idempotent. It creates the `matching` database, the `uploads` table (row security on), the `originals` and `states` buckets, the `members` team, and the owner account with an owner membership. Re-running reports what already existed. `OWNER_*` variables are used only by this script.

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
