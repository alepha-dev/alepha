import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaRedis, RedisActivation } from "../index.ts";

/**
 * `REDIS_URL: undefined` is spelled out on every container: the machine
 * running the spec may export a REDIS_URL of its own.
 */
describe("RedisActivation", () => {
  it("is active when REDIS_URL is set", ({ expect }) => {
    const alepha = Alepha.create({
      env: { REDIS_URL: "redis://localhost:16379" },
    });

    expect(alepha.inject(RedisActivation).isActive()).toBe(true);
  });

  it("is off without REDIS_URL, whatever the schema default used to be", ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { REDIS_URL: undefined } });

    expect(alepha.inject(RedisActivation).isActive()).toBe(false);
  });

  it("is off when REDIS_URL is empty or blank", ({ expect }) => {
    for (const value of ["", "  "]) {
      const alepha = Alepha.create({ env: { REDIS_URL: value } });
      expect(alepha.inject(RedisActivation).isActive()).toBe(false);
    }
  });
});

describe("AlephaRedis without REDIS_URL", () => {
  it("fails at boot naming REDIS_URL instead of dialling localhost", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { REDIS_URL: undefined } });

    await expect(async () => {
      alepha.with(AlephaRedis);
      await alepha.start();
    }).rejects.toThrow(/REDIS_URL/);
  });
});
