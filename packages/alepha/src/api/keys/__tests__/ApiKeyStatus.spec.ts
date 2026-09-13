import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AdminApiKeyController } from "../controllers/AdminApiKeyController.ts";
import { ApiKeyController } from "../controllers/ApiKeyController.ts";
import { apiKeyEntity } from "../entities/apiKeyEntity.ts";
import { AlephaApiKeys } from "../index.ts";
import { apiKeyOptions } from "../parameters/ApiKeyParameters.ts";
import type { ApiKeyStatus } from "../schemas/apiKeyStatusSchema.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

class TestApp {
  keys = $repository(apiKeyEntity);
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

const setup = async (expiryWarningDays?: number) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  const app = alepha.inject(TestApp);
  if (expiryWarningDays !== undefined) {
    alepha.store.set(apiKeyOptions, {
      ...alepha.store.get(apiKeyOptions),
      expiryWarningDays,
    });
  }
  const service = alepha.inject(ApiKeyService);
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();
  time.pause();

  const userId = randomUUID();
  const at = (offset: number) => new Date(time.nowMillis() + offset);

  /**
   * One key in each state, for one owner.
   */
  const seed = async () => {
    const make = (name: string, expiresAt?: Date) =>
      service.create({ userId, name, roles: ["admin"], expiresAt });

    const active = await make("active");
    const farFuture = await make("far future", at(30 * DAY));
    const expiring = await make("expiring", at(2 * DAY));
    const expired = await make("expired", at(-HOUR));
    const revoked = await make("revoked");
    await service.revoke(revoked.apiKey.id, userId);
    const revokedExpired = await make("revoked and expired", at(-DAY));
    await service.revoke(revokedExpired.apiKey.id, userId);

    return {
      active: active.apiKey.id,
      farFuture: farFuture.apiKey.id,
      expiring: expiring.apiKey.id,
      expired: expired.apiKey.id,
      revoked: revoked.apiKey.id,
      revokedExpired: revokedExpired.apiKey.id,
    };
  };

  return { alepha, app, service, time, userId, at, seed };
};

describe("API key status", () => {
  it("derives one status per key, revoked winning over expired", async () => {
    const { service, userId, seed } = await setup();
    const ids = await seed();

    const byId = new Map(
      (await service.list(userId)).map((key) => [key.id, key.status]),
    );

    expect(byId.get(ids.active)).toBe("active");
    expect(byId.get(ids.farFuture)).toBe("active");
    expect(byId.get(ids.expiring)).toBe("expiring");
    expect(byId.get(ids.expired)).toBe("expired");
    expect(byId.get(ids.revoked)).toBe("revoked");
    expect(byId.get(ids.revokedExpired)).toBe("revoked");
  });

  it("reads a key an hour from expiry as active when expiryWarningDays is 0", async () => {
    const { service, userId, at } = await setup(0);

    const { apiKey } = await service.create({
      userId,
      name: "almost gone",
      roles: [],
      expiresAt: at(HOUR),
    });

    expect(service.statusOf(apiKey)).toBe("active");
  });

  it("matches the same keys in a query as it derives on read", async () => {
    const { app, service, userId, seed } = await setup();
    const ids = await seed();

    const expected: Record<ApiKeyStatus, string[]> = {
      active: [ids.active, ids.farFuture],
      expiring: [ids.expiring],
      expired: [ids.expired],
      revoked: [ids.revoked, ids.revokedExpired],
    };

    for (const status of Object.keys(expected) as ApiKeyStatus[]) {
      const rows = await app.keys.findMany({
        where: {
          and: [{ userId: { eq: userId } }, service.statusWhere([status])],
        },
        columns: ["id"],
      });
      expect(rows.map((row) => row.id).sort()).toEqual(expected[status].sort());
    }

    const live = await app.keys.findMany({
      where: {
        and: [
          { userId: { eq: userId } },
          service.statusWhere(["active", "expiring", "expired"]),
        ],
      },
      columns: ["id"],
    });
    expect(live).toHaveLength(4);
  });

  it("matches nothing for 'expiring' when the warning is disabled", async () => {
    const { app, service, userId, seed } = await setup(0);
    await seed();

    const rows = await app.keys.findMany({
      where: {
        and: [{ userId: { eq: userId } }, service.statusWhere(["expiring"])],
      },
    });
    expect(rows).toHaveLength(0);
  });
});

describe("the API key list", () => {
  it("returns expired and revoked keys, with description and revokedAt, through the controller", async () => {
    const { alepha, service, userId, seed } = await setup();
    const ids = await seed();
    await service.create({
      userId,
      name: "described",
      description: "Deploys from CI",
      roles: [],
    });

    const listed = await alepha
      .inject(ApiKeyController)
      .listApiKeys.run({}, { user: { id: userId, roles: ["admin"] } });

    expect(listed).toHaveLength(7);
    const revoked = listed.find((key) => key.id === ids.revoked);
    expect(revoked?.revokedAt).toBeDefined();
    expect(revoked?.status).toBe("revoked");
    expect(listed.find((key) => key.name === "described")?.description).toBe(
      "Deploys from CI",
    );
  });

  it("never carries the token hash, over action.run() or HTTP", async () => {
    const { alepha, service, userId } = await setup();
    const { apiKey } = await service.create({ userId, name: "k", roles: [] });
    const admin = { id: randomUUID(), roles: ["admin"] };
    const owner = { id: userId, roles: ["admin"] };

    const listController = alepha.inject(ApiKeyController);
    const adminController = alepha.inject(AdminApiKeyController);

    const reads: unknown[] = [
      ...(await service.list(userId)),
      await service.getById(apiKey.id),
      ...(await listController.listApiKeys.run({}, { user: owner })),
      await adminController.getApiKey.run(
        { params: { id: apiKey.id } },
        { user: admin },
      ),
      ...(
        await adminController.findApiKeys.run(
          { query: { userId } },
          { user: admin },
        )
      ).content,
      ...(await listController.listApiKeys.fetch({}, { user: owner })).data,
      (
        await adminController.getApiKey.fetch(
          { params: { id: apiKey.id } },
          { user: admin },
        )
      ).data,
    ];

    for (const read of reads) {
      expect(read).not.toHaveProperty("tokenHash");
    }
  });
});

describe("revoking an API key", () => {
  it("does not move revokedAt when the key is revoked a second time", async () => {
    const { service, time, userId } = await setup();
    const { apiKey } = await service.create({ userId, name: "k", roles: [] });

    await service.revoke(apiKey.id, userId);
    const first = (await service.getById(apiKey.id)).revokedAt;

    await time.travel(1, "hour");
    await service.revoke(apiKey.id, userId);

    expect((await service.getById(apiKey.id)).revokedAt).toBe(first);
  });

  it("frees the key's name, which a live or an expired key still holds", async () => {
    const { service, userId, at } = await setup();

    const live = await service.create({ userId, name: "CI", roles: [] });
    await expect(
      service.create({ userId, name: "CI", roles: [] }),
    ).rejects.toThrow();

    await service.revoke(live.apiKey.id, userId);
    const reused = await service.create({ userId, name: "CI", roles: [] });
    expect(reused.apiKey.name).toBe("CI");

    await service.create({
      userId,
      name: "Nightly",
      roles: [],
      expiresAt: at(-HOUR),
    });
    await expect(
      service.create({ userId, name: "Nightly", roles: [] }),
    ).rejects.toThrow();
  });
});
