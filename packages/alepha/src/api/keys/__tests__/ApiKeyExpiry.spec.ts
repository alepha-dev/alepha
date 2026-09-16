import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ApiKeyController } from "../controllers/ApiKeyController.ts";
import { AlephaApiKeys } from "../index.ts";
import { apiKeyOptions } from "../parameters/ApiKeyParameters.ts";
import type { ApiKeyExpiresIn } from "../schemas/apiKeyExpiresInSchema.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

const DAY = 24 * 60 * 60 * 1000;

class TestApp {
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

const setup = async (maxExpiryDays = 0) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  alepha.inject(TestApp);
  alepha.store.set(apiKeyOptions, {
    ...alepha.store.get(apiKeyOptions),
    maxExpiryDays,
  });

  const service = alepha.inject(ApiKeyService);
  const controller = alepha.inject(ApiKeyController);
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();

  return { service, controller, time };
};

describe("API key expiry policy", () => {
  it("resolves every preset from the current time", async () => {
    const { service, time } = await setup();

    // Move the clock so a preset resolved from the real wall clock, rather
    // than from DateTimeProvider, lands on the wrong instant.
    time.pause();
    await time.travel(3, "days");

    const presets: Array<[ApiKeyExpiresIn, number]> = [
      ["7d", 7],
      ["30d", 30],
      ["60d", 60],
      ["90d", 90],
      ["180d", 180],
      ["1y", 365],
    ];

    for (const [expiresIn, days] of presets) {
      const { apiKey } = await service.create({
        userId: randomUUID(),
        name: `preset ${expiresIn}`,
        roles: [],
        expiresIn,
      });
      expect(new Date(apiKey.expiresAt!).getTime()).toBe(
        time.nowMillis() + days * DAY,
      );
    }
  });

  it("creates a key without expiry for 'never' and for no expiry at all while uncapped", async () => {
    const { service } = await setup();

    const never = await service.create({
      userId: randomUUID(),
      name: "never",
      roles: [],
      expiresIn: "never",
    });
    const omitted = await service.create({
      userId: randomUUID(),
      name: "omitted",
      roles: [],
    });

    expect(never.apiKey.expiresAt).toBeUndefined();
    expect(omitted.apiKey.expiresAt).toBeUndefined();
  });

  it("refuses a preset over the cap, naming it, and admits one within", async () => {
    const { service } = await setup(30);

    await expect(
      service.create({
        userId: randomUUID(),
        name: "too long",
        roles: [],
        expiresIn: "90d",
      }),
    ).rejects.toThrow("30 days");

    const { apiKey } = await service.create({
      userId: randomUUID(),
      name: "within",
      roles: [],
      expiresIn: "30d",
    });
    expect(apiKey.expiresAt).toBeDefined();
  });

  it("refuses 'never' and an omitted expiry under a cap", async () => {
    const { service } = await setup(30);

    await expect(
      service.create({
        userId: randomUUID(),
        name: "never",
        roles: [],
        expiresIn: "never",
      }),
    ).rejects.toThrow("30 days");
    await expect(
      service.create({ userId: randomUUID(), name: "omitted", roles: [] }),
    ).rejects.toThrow("30 days");
  });

  it("refuses a raw expiresAt over the cap rather than clamping it", async () => {
    // The whole point of resolving the preset on the server: a client that
    // computes its own date cannot step around the policy.
    const { service, time } = await setup(30);

    await expect(
      service.create({
        userId: randomUUID(),
        name: "posted directly",
        roles: [],
        expiresAt: new Date(time.nowMillis() + 31 * DAY),
      }),
    ).rejects.toThrow("30 days");

    const within = new Date(time.nowMillis() + 29 * DAY);
    const { apiKey } = await service.create({
      userId: randomUUID(),
      name: "posted within",
      roles: [],
      expiresAt: within,
    });
    expect(new Date(apiKey.expiresAt!).getTime()).toBe(within.getTime());
  });

  it("refuses expiresIn and expiresAt together", async () => {
    const { service, time } = await setup();

    await expect(
      service.create({
        userId: randomUUID(),
        name: "both",
        roles: [],
        expiresIn: "7d",
        expiresAt: new Date(time.nowMillis() + DAY),
      }),
    ).rejects.toThrow("not both");
  });

  it("enforces the cap in the service, so action.run() is refused too", async () => {
    const { controller, time } = await setup(30);
    time.pause();
    const user = { id: randomUUID(), name: "Owner", roles: ["admin"] };

    await expect(
      controller.createApiKey.run(
        {
          body: {
            name: "over the cap",
            expiresAt: new Date(time.nowMillis() + 60 * DAY).toISOString(),
          },
        },
        { user },
      ),
    ).rejects.toThrow("30 days");

    const created = await controller.createApiKey.run(
      { body: { name: "within the cap", expiresIn: "7d" } },
      { user },
    );
    expect(new Date(created.expiresAt!).getTime()).toBe(
      time.nowMillis() + 7 * DAY,
    );
  });
});
