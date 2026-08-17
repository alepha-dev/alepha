import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { SIGIL_DEFAULT_SINK, sigilEnv } from "../sigilEnv.ts";

describe("sigilEnv", () => {
  it("reads a configured sink", () => {
    const alepha = Alepha.create({
      env: {
        SIGIL_CONFIG: '{"project":"demo","sink":"https://sigil.example.com"}',
        SIGIL_KEY: "tk_secret",
      },
    });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_CONFIG?.sink).toBe("https://sigil.example.com");
    expect(env.SIGIL_CONFIG?.project).toBe("demo");
    expect(env.SIGIL_KEY).toBe("tk_secret");
  });

  it("treats an absent key as a mode, not a misconfiguration", () => {
    // The headless case: an app that must not phone home still boots, and
    // still captures. Throwing here would make "report nothing" impossible to
    // express without deleting the module.
    const alepha = Alepha.create({ env: {} });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_KEY).toBe("");
    expect(env.SIGIL_SALT).toBe("");
  });

  it("defaults the sink to the public instance, inertly", () => {
    // The default is safe to carry only because it does nothing on its own:
    // `hasSink()` gates every flush on the key, so an app that sets no
    // variables sends nothing despite having a sink origin resolved. If this
    // ever stops being true, the default becomes a data leak.
    const alepha = Alepha.create({ env: {} });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_CONFIG).toBeUndefined();
    expect(env.SIGIL_KEY).toBe("");
  });

  it("lets a self-hoster override the default sink", () => {
    const alepha = Alepha.create({
      env: {
        SIGIL_CONFIG:
          '{"project":"demo","sink":"https://lore.internal.example.com"}',
      },
    });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_CONFIG?.sink).toBe("https://lore.internal.example.com");
  });

  it("defaults the sink, and every tracker, from a minimal config", () => {
    const alepha = Alepha.create({
      env: { SIGIL_CONFIG: '{"project":"demo"}' },
    });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_CONFIG?.sink).toBe(SIGIL_DEFAULT_SINK);
    expect(env.SIGIL_CONFIG?.analytics).toBe(true);
    expect(env.SIGIL_CONFIG?.blights).toBe(true);
    expect(env.SIGIL_CONFIG?.vitals).toBe(true);
    expect(env.SIGIL_CONFIG?.feedbackButton).toBe("bottom-right");
  });
});
