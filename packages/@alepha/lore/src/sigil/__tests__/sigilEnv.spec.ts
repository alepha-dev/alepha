import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { SIGIL_DEFAULT_SINK, sigilEnv } from "../sigilEnv.ts";

describe("sigilEnv", () => {
  it("enrols an app from the key alone", () => {
    // The whole point of the shape: one secret, nothing to keep in sync with
    // it. If this ever needs a second variable again, the reason had better be
    // better than the one that was there before.
    const alepha = Alepha.create({ env: { SIGIL_KEY: "sg_demo_secret" } });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_KEY).toBe("sg_demo_secret");
    expect(env.SIGIL_SINK).toBe(SIGIL_DEFAULT_SINK);
    expect(env.SIGIL_CONFIG).toBeUndefined();
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

    expect(env.SIGIL_SINK).toBe(SIGIL_DEFAULT_SINK);
    expect(env.SIGIL_KEY).toBe("");
  });

  it("lets a self-hoster override the default sink with one flat name", () => {
    const alepha = Alepha.create({
      env: { SIGIL_SINK: "https://lore.internal.example.com" },
    });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_SINK).toBe("https://lore.internal.example.com");
  });

  it("defaults every switch from an empty config", () => {
    // `{}` has to be a legal config: it is what an app writes when it wants
    // the defaults but the deploy platform insists on a value.
    const alepha = Alepha.create({ env: { SIGIL_CONFIG: "{}" } });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_CONFIG?.analytics).toBe(true);
    expect(env.SIGIL_CONFIG?.blights).toBe(true);
    expect(env.SIGIL_CONFIG?.vitals).toBe(true);
    expect(env.SIGIL_CONFIG?.feedback).toBe(true);
    expect(env.SIGIL_CONFIG?.feedbackButton).toBe("bottom-right");
    expect(env.SIGIL_CONFIG?.feedbackButtonExcludedPaths).toEqual([]);
  });

  it("reads the switches an operator actually turns off", () => {
    const alepha = Alepha.create({
      env: {
        SIGIL_CONFIG: '{"vitals":false,"feedbackButton":"hidden"}',
      },
    });

    const env = alepha.parseEnv(sigilEnv);

    expect(env.SIGIL_CONFIG?.vitals).toBe(false);
    expect(env.SIGIL_CONFIG?.feedbackButton).toBe("hidden");
    expect(env.SIGIL_CONFIG?.analytics).toBe(true);
  });
});
