import { Client, Storage } from "appwrite";
import { appwriteEndpoint, appwriteProjectId } from "./config";

/** Browser Storage client authenticated with a short-lived JWT. */
export function getBrowserStorage(jwt: string): Storage {
  const client = new Client()
    .setEndpoint(appwriteEndpoint())
    .setProject(appwriteProjectId())
    .setJWT(jwt);
  return new Storage(client);
}
