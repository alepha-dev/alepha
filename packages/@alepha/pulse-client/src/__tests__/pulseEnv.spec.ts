import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { pulseEnv } from "../pulseEnv.ts";

describe("pulseEnv", () => {
  it("reads a configured sink", () => {
    const alepha = Alepha.create({
      env: {
        PULSE_SINK: "https://pulse.example.com",
        PULSE_KEY: "tk_secret",
      },
    });

    const env = alepha.parseEnv(pulseEnv);

    expect(env.PULSE_SINK).toBe("https://pulse.example.com");
    expect(env.PULSE_KEY).toBe("tk_secret");
  });

  it("treats an absent sink as a mode, not a misconfiguration", () => {
    // The headless case: an app that must not phone home still boots, and
    // still captures. Throwing here would make "no telemetry" impossible to
    // express without deleting the module.
    const alepha = Alepha.create({ env: {} });

    const env = alepha.parseEnv(pulseEnv);

    expect(env.PULSE_SINK).toBeUndefined();
    expect(env.PULSE_KEY).toBeUndefined();
  });
});
