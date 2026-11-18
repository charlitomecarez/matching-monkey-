// Idempotent Appwrite bootstrap. Run:
//   node --env-file=.env.local scripts/setup-appwrite.mjs
import {
  Client,
  Permission,
  Query,
  Role,
  Teams,
  TablesDB,
  Storage,
  Users,
  ID,
  TablesDBIndexType,
} from "node-appwrite";

const required = [
  "NEXT_PUBLIC_APPWRITE_ENDPOINT",
  "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
  "OWNER_EMAIL",
  "OWNER_PASSWORD",
  "OWNER_NAME",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const tables = new TablesDB(client);
const storage = new Storage(client);
const teams = new Teams(client);
const users = new Users(client);

const DB = "matching";
const TABLE = "uploads";
const TEAM = "members";
const memberCreate = [Permission.create(Role.team(TEAM))];

/** Run `fn`; log created/existed. Treat HTTP 409 as "already exists". */
async function ensure(label, fn) {
  try {
    const result = await fn();
    console.log(`created  ${label}`);
    return result;
  } catch (err) {
    if (err?.code === 409) {
      console.log(`existed  ${label}`);
      return undefined;
    }
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForColumns(keys) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const statuses = await Promise.all(
      keys.map(async (key) =>
        (await tables.getColumn({ databaseId: DB, tableId: TABLE, key })).status,
      ),
    );
    if (statuses.every((s) => s === "available")) return;
    if (statuses.some((s) => s === "failed" || s === "stuck")) {
      throw new Error(`Column creation failed: ${statuses.join(",")}`);
    }
    await sleep(1000);
  }
  throw new Error("Timed out waiting for columns to become available");
}

// Database + table
await ensure(`database ${DB}`, () =>
  tables.create({ databaseId: DB, name: "Matching" }),
);
await ensure(`table ${TABLE}`, () =>
  tables.createTable({
    databaseId: DB,
    tableId: TABLE,
    name: "Uploads",
    permissions: memberCreate,
    rowSecurity: true,
  }),
);

const varchars = [
  ["ownerId", 36],
  ["name", 255],
  ["originalFileId", 36],
  ["stateFileId", 36],
];
const integers = ["version", "rowCount", "sheetCount"];
for (const [key, size] of varchars) {
  await ensure(`column ${key}`, () =>
    tables.createVarcharColumn({
      databaseId: DB,
      tableId: TABLE,
      key,
      size,
      required: true,
    }),
  );
}
for (const key of integers) {
  await ensure(`column ${key}`, () =>
    tables.createIntegerColumn({
      databaseId: DB,
      tableId: TABLE,
      key,
      required: true,
    }),
  );
}

await waitForColumns([...varchars.map(([k]) => k), ...integers]);
await ensure("index ownerId_key", () =>
  tables.createIndex({
    databaseId: DB,
    tableId: TABLE,
    key: "ownerId_key",
    type: TablesDBIndexType.Key,
    columns: ["ownerId"],
  }),
);

// Buckets
const MAX = 50 * 1024 * 1024;
for (const [id, name, ext] of [
  ["originals", "Originals", "xlsx"],
  ["states", "States", "json"],
]) {
  await ensure(`bucket ${id}`, () =>
    storage.createBucket({
      bucketId: id,
      name,
      permissions: memberCreate,
      fileSecurity: true,
      maximumFileSize: MAX,
      allowedFileExtensions: [ext],
    }),
  );
}

// Team
await ensure(`team ${TEAM}`, () =>
  teams.create({ teamId: TEAM, name: "Members" }),
);

// Owner bootstrap
const email = process.env.OWNER_EMAIL;
let userId;
const created = await ensure(`user ${email}`, () =>
  users.create({
    userId: ID.unique(),
    email,
    password: process.env.OWNER_PASSWORD,
    name: process.env.OWNER_NAME,
  }),
);
if (created) {
  userId = created.$id;
} else {
  const found = await users.list({ queries: [Query.equal("email", email)] });
  userId = found.users[0]?.$id;
  if (!userId) throw new Error(`Could not find existing user ${email}`);
}

// Created with the API key, so the membership is auto-confirmed.
await ensure(`owner membership for ${email}`, () =>
  teams.createMembership({ teamId: TEAM, roles: ["owner"], userId }),
);

console.log("Setup complete.");
