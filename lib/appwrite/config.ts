export const IDS = {
  database: "matching",
  uploads: "uploads",
  originals: "originals",
  states: "states",
  team: "members",
} as const;

export const SESSION_COOKIE = "mm_session";

export const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT as string;
export const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID as string;
