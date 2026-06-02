import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { sigilEnv } from "../sigilEnv.ts";

describe("sigilEnv", () => {
  it("parses with SIGIL_ID present", () => {
    const alepha = Alepha.create({
      env: { SIGIL_ID: "uuid-1", LORE_URL: "https://x" },
    });
    const env = alepha.parseEnv(sigilEnv);
    expect(env.SIGIL_ID).toBe("uuid-1");
    expect(env.LORE_URL).toBe("https://x");
  });

  it("does not throw when SIGIL_ID is absent (optional)", () => {
    const alepha = Alepha.create({ env: {} });
    const env = alepha.parseEnv(sigilEnv);
    expect(env.SIGIL_ID).toBeUndefined();
  });
});
