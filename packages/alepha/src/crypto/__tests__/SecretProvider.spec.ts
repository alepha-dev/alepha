import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { SecretProvider } from "../providers/SecretProvider.ts";

describe("SecretProvider", () => {
  it("throws on start in production when APP_SECRET is the default", async () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "production" } });
    // Register the provider so its `configure` hook runs on start.
    alepha.inject(SecretProvider);

    await expect(alepha.start()).rejects.toThrow(/SecretProvider|APP_SECRET/);
  });

  it("starts in production when APP_SECRET is set to a non-default value", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", APP_SECRET: "a-strong-unique-secret" },
    });
    alepha.inject(SecretProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    await alepha.stop();
  });

  it("only warns (does not throw) outside production with the default secret", async () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    alepha.inject(SecretProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    await alepha.stop();
  });
});
