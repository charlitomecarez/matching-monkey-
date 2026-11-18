import "server-only";
import { Account, Client, Storage, TablesDB, Teams, Users } from "node-appwrite";
import { ENDPOINT, PROJECT_ID } from "./config";

function baseClient() {
  return new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
}

/** API-key client. Server-only; never expose to the browser. */
export function createAdminClient() {
  const client = baseClient().setKey(process.env.APPWRITE_API_KEY as string);
  return {
    account: new Account(client),
    users: new Users(client),
    teams: new Teams(client),
    tables: new TablesDB(client),
    storage: new Storage(client),
  };
}

/** Client acting as the signed-in user, from the session secret cookie. */
export function createSessionClient(secret: string) {
  const client = baseClient().setSession(secret);
  return {
    account: new Account(client),
    teams: new Teams(client),
    tables: new TablesDB(client),
    storage: new Storage(client),
  };
}

/** Project-only client (no key, no session), e.g. for accepting invites. */
export function createPublicClient() {
  const client = baseClient();
  return { teams: new Teams(client) };
}
