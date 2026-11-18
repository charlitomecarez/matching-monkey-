export const IDS = {
  database: "matching",
  uploads: "uploads",
  // Appwrite Cloud's Free plan allows one storage bucket, so original .xlsx files and saved
  // state files share it. Their IDs can't collide: state files are `<uploadId>.v<n>`.
  originals: "originals",
  states: "originals",
  team: "members",
} as const;

export const SESSION_COOKIE = "mm_session";

/** The value, or a clear error naming the missing variable. */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing environment variable ${name}. Set it in .env.local (dev) or the Vercel project settings.`);
  }
  return value;
}

// Read lazily (when a client is built), so `next build` works without the variables set.
// The literal `process.env.NEXT_PUBLIC_…` accesses are required for Next to inline them in the browser bundle.
export const appwriteEndpoint = (): string =>
  requireEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT);
export const appwriteProjectId = (): string =>
  requireEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID", process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID);

/** Public base URL of this app (server-only env), used for invite redirect links. */
export const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
