import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE, PROFILE_QUERY, REQUEST_CONFIG } from "@/lib/profile";

describe("profile", () => {
  it("names the profile registered from profiles/design-studio.toml", () => {
    const toml = readFileSync(new URL("../../profiles/design-studio.toml", import.meta.url), "utf8");
    expect(toml).toMatch(new RegExp(`^name = "${PROFILE}"$`, "m"));
    expect(PROFILE_QUERY).toBe("?profile=design_studio");
  });

  it("carries the former startup defaults per request", () => {
    expect(REQUEST_CONFIG).toMatchObject({ thinking_budget: 4000, enable_working_memory: false });
  });
});
