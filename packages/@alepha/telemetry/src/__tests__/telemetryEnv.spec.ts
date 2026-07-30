import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { telemetryEnv } from "../telemetryEnv.ts";

describe("telemetryEnv", () => {
  it("reads a configured sink", () => {
    const alepha = Alepha.create({
      env: {
        TELEMETRY_SINK: "https://pulse.example.com",
        TELEMETRY_KEY: "tk_secret",
      },
    });

    const env = alepha.parseEnv(telemetryEnv);

    expect(env.TELEMETRY_SINK).toBe("https://pulse.example.com");
    expect(env.TELEMETRY_KEY).toBe("tk_secret");
  });

  it("treats an absent sink as a mode, not a misconfiguration", () => {
    // The headless case: an app that must not phone home still boots, and
    // still captures. Throwing here would make "no telemetry" impossible to
    // express without deleting the module.
    const alepha = Alepha.create({ env: {} });

    const env = alepha.parseEnv(telemetryEnv);

    expect(env.TELEMETRY_SINK).toBeUndefined();
    expect(env.TELEMETRY_KEY).toBeUndefined();
  });
});
