import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { sigilEnv } from "../sigilEnv.ts";

describe("sigilEnv", () => {
  it("reads a configured sink", () => {
    const alepha = Alepha.create({
      env: {
        SIGIL_SINK: "https://sigil.example.com",
        SIGIL_KEY: "tk_secret",
      },
    });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_SINK).toBe("https://sigil.example.com");
    expect(env.SIGIL_KEY).toBe("tk_secret");
  });

  it("treats an absent sink as a mode, not a misconfiguration", () => {
    // The headless case: an app that must not phone home still boots, and
    // still captures. Throwing here would make "report nothing" impossible to
    // express without deleting the module.
    const alepha = Alepha.create({ env: {} });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_SINK).toBeUndefined();
    expect(env.SIGIL_KEY).toBeUndefined();
  });
});
