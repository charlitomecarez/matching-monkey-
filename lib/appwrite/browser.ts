import { Client, Storage } from "appwrite";
import { ENDPOINT, PROJECT_ID } from "./config";

/** Browser Storage client authenticated with a short-lived JWT. */
export function getBrowserStorage(jwt: string): Storage {
  const client = new Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID)
    .setJWT(jwt);
  return new Storage(client);
}
