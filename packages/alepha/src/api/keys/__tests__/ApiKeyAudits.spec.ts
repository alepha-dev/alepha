import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AdminApiKeyController } from "../controllers/AdminApiKeyController.ts";
import { apiKeyEntity } from "../entities/apiKeyEntity.ts";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Direct access to the table, to date a revocation in the past.
 */
class TestKeys {
  keys = $repository(apiKeyEntity);
}

class TestApp {
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  alepha.inject(TestApp);
  alepha.inject(TestKeys);
  const service = alepha.inject(ApiKeyService);
  const audits = alepha.inject(AuditService);
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();
  time.pause();

  const ownerId = randomUUID();

  /**
   * The api-key rows about one key, oldest first.
   */
  const rowsFor = async (apiKeyId: string) =>
    (
      await audits.find({ type: "api-key", resourceId: apiKeyId, size: 100 })
    ).content
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { alepha, service, audits, time, ownerId, rowsFor };
};

describe("the api-key audit trail", () => {
  it("records create, rotate and revoke with the actor, as the owner", async () => {
    const { service, time, ownerId, rowsFor } = await setup();

    const { apiKey, token } = await service.create({
      userId: ownerId,
      name: "CI pipeline",
      roles: [],
    });
    await time.travel(1, "minute");
    const rotated = await service.rotate(apiKey.id, ownerId);
    await time.travel(1, "minute");
    await service.revoke(apiKey.id, ownerId);

    const rows = await rowsFor(apiKey.id);
    expect(rows.map((row) => row.action)).toEqual([
      "create",
      "rotate",
      "revoke",
    ]);
    for (const row of rows) {
      expect(row.userId).toBe(ownerId);
      expect(row.metadata).toMatchObject({
        name: "CI pipeline",
        ownerId,
        actor: "owner",
      });
    }

    // Never the secret, in any form.
    const everything = JSON.stringify(rows);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(rotated.token);
    expect(everything).not.toContain(apiKey.tokenHash);
    expect(everything).not.toContain("tokenHash");
  });

  it("records an admin revocation as the admin, for one key and for many", async () => {
    const { alepha, service, ownerId, rowsFor } = await setup();
    const admin = { id: randomUUID(), roles: ["admin"] };
    const controller = alepha.inject(AdminApiKeyController);

    const one = await service.create({
      userId: ownerId,
      name: "one",
      roles: [],
    });
    const two = await service.create({
      userId: ownerId,
      name: "two",
      roles: [],
    });

    await controller.revokeApiKey.run(
      { params: { id: one.apiKey.id } },
      { user: admin },
    );
    await controller.revokeApiKeys.run(
      { body: { ids: [two.apiKey.id] } },
      { user: admin },
    );

    for (const id of [one.apiKey.id, two.apiKey.id]) {
      const revoke = (await rowsFor(id)).find((row) => row.action === "revoke");
      expect(revoke?.userId).toBe(admin.id);
      expect(revoke?.metadata).toMatchObject({ ownerId, actor: "admin" });
    }
  });

  it("does not audit usage: validating a key writes no audit row", async () => {
    const { service, ownerId, rowsFor } = await setup();

    const { apiKey, token } = await service.create({
      userId: ownerId,
      name: "busy",
      roles: [],
    });
    await service.validate(token);
    await service.validate(token);

    expect((await rowsFor(apiKey.id)).map((row) => row.action)).toEqual([
      "create",
    ]);
  });

  it("records a purge run as one row with its counts, and nothing when it deletes nothing", async () => {
    // No `travel()` here: it would fire the daily purge on the way and log
    // rows of its own. The dead keys are dated in the past instead.
    const { alepha, service, audits, time, ownerId } = await setup();
    const repo = alepha.inject(TestKeys).keys;

    const purges = async () =>
      (await audits.find({ type: "api-key", action: "purge", size: 1000 }))
        .content;

    await service.purgeDeadKeys();
    expect(await service.purgeDeadKeys()).toEqual({ expired: 0, revoked: 0 });
    // A run that deleted nothing logs nothing: no purge row anywhere says so.
    // (Counted by content rather than by length, since other suites share
    // the table and purge in parallel.)
    expect(
      (await purges()).filter(
        (row) =>
          JSON.stringify(row.metadata) ===
          JSON.stringify({ expired: 0, revoked: 0 }),
      ),
    ).toHaveLength(0);

    const expired = await service.create({
      userId: ownerId,
      name: "long expired",
      roles: [],
      expiresAt: new Date(time.nowMillis() - 200 * DAY),
    });
    const revoked = await service.create({
      userId: ownerId,
      name: "long revoked",
      roles: [],
    });
    await repo.updateById(revoked.apiKey.id, {
      revokedAt: new Date(time.nowMillis() - 200 * DAY).toISOString(),
    });

    const counts = await service.purgeDeadKeys();
    expect(counts.expired).toBeGreaterThanOrEqual(1);
    expect(counts.revoked).toBeGreaterThanOrEqual(1);
    expect(await repo.findById(expired.apiKey.id)).toBeUndefined();

    const rows = (await purges()).filter(
      (row) =>
        JSON.stringify(row.metadata) === JSON.stringify(counts) &&
        row.userId === undefined,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
