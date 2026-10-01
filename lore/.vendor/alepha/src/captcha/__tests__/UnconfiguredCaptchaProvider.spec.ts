import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  CaptchaProvider,
  MemoryCaptchaProvider,
  UnconfiguredCaptchaProvider,
} from "../index.ts";

describe("UnconfiguredCaptchaProvider", () => {
  it("is the default outside test", async ({ expect }) => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", LOG_LEVEL: "silent" },
    });
    const provider = alepha.inject(CaptchaProvider);
    await alepha.start();

    // MemoryCaptchaProvider accepts EVERY token. As the production default it
    // made `captchaRequired: true` mean nothing at all.
    expect(provider).toBeInstanceOf(UnconfiguredCaptchaProvider);
    expect(provider).not.toBeInstanceOf(MemoryCaptchaProvider);
  });

  it("refuses every token", async ({ expect }) => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", LOG_LEVEL: "silent" },
    });
    const provider = alepha.inject(CaptchaProvider);
    await alepha.start();

    expect(await provider.verify("anything")).toBe(false);
    expect(provider.configured).toBe(false);
  });

  it("keeps the accept-all memory provider under test", async ({ expect }) => {
    const alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    const provider = alepha.inject(CaptchaProvider);
    await alepha.start();

    expect(provider).toBeInstanceOf(MemoryCaptchaProvider);
    expect(provider.configured).toBe(true);
    expect(await provider.verify("anything")).toBe(true);
  });
});
