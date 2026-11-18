import { describe, expect, it } from "vitest";
import { requireEnv } from "./config";

describe("requireEnv", () => {
  it("returns a set value", () => {
    expect(requireEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", "https://x/v1")).toBe("https://x/v1");
  });

  it("names the missing variable", () => {
    expect(() => requireEnv("APPWRITE_API_KEY", undefined)).toThrow(
      "Missing environment variable APPWRITE_API_KEY",
    );
    expect(() => requireEnv("APPWRITE_API_KEY", "  ")).toThrow("APPWRITE_API_KEY");
  });
});
