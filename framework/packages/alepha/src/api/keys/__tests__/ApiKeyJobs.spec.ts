import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { apiKeyEntity } from "../entities/apiKeyEntity.ts";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyJobs } from "../jobs/ApiKeyJobs.ts";
import {
  type ApiKeyOptions,
  apiKeyOptions,
} from "../parameters/ApiKeyParameters.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Two rows a batch, so a backlog past one run's cap (ten batches) fits in a
 * test.
 */
class SmallBatchApiKeyService extends ApiKeyService {
  protected purgeBatchSize(): number {
    return 2;
  }
}

class TestApp {
  keys = $repository(apiKeyEntity);
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

const setup = async (
  options: Partial<ApiKeyOptions> = {},
  service?: typeof ApiKeyService,
) => {
  const alepha = Alepha.create();
  if (service) {
    alepha.with({ provide: ApiKeyService, use: service });
  }
  alepha
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  const app = alepha.inject(TestApp);
  alepha.store.set(apiKeyOptions, {
    ...alepha.store.get(apiKeyOptions),
    ...options,
  });
  const keys = alepha.inject(ApiKeyService);
  const jobs = alepha.inject(ApiKeyJobs);
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();
  time.pause();

  const userId = randomUUID();

  /**
   * A key that expired `days` days ago.
   */
  const expiredFor = async (name: string, days: number) =>
    (
      await keys.create({
        userId,
        name,
        roles: [],
        expiresAt: new Date(time.nowMillis() - days * DAY),
      })
    ).apiKey.id;

  /**
   * A key revoked now. Move the clock afterwards to age the revocation.
   */
  const revokedAt = async (name: string) => {
    const { apiKey } = await keys.create({ userId, name, roles: [] });
    await keys.revoke(apiKey.id, userId);
    return apiKey.id;
  };

  const remaining = async () =>
    (
      await app.keys.findMany({
        where: { userId: { eq: userId } },
        columns: ["id"],
      })
    ).map((row) => row.id);

  return { app, keys, jobs, time, userId, expiredFor, revokedAt, remaining };
};

/**
 * The windows are driven through `ApiKeyService.purgeDeadKeys()`, the method
 * the job runs, with `travel()` ageing the rows: a trigger right after
 * `travel()` can be skipped by the cron's own run lock.
 */
describe("ApiKeyJobs.purgeExpired", () => {
  it("deletes a key expired past the window and keeps one inside it, under travel()", async () => {
    const { keys, time, expiredFor, remaining } = await setup();

    const inside = await expiredFor("expired 88 days", 88);
    const outside = await expiredFor("expired 90 days", 90);

    // One day on: 89 days against 91. `travel()` may fire the daily cron on
    // the way, so only the end state is asserted, after a purge run.
    await time.travel(1, "day");
    await keys.purgeDeadKeys();

    expect(await remaining()).toEqual([inside]);
    expect(await remaining()).not.toContain(outside);
  });

  it("deletes a key revoked past the window", async () => {
    const { keys, time, revokedAt, remaining } = await setup();

    const old = await revokedAt("revoked long ago");
    await time.travel(91, "days");
    const recent = await revokedAt("revoked just now");

    await keys.purgeDeadKeys();

    expect(await remaining()).toEqual([recent]);
    expect(await remaining()).not.toContain(old);
  });

  it("disables the expired window alone with purgeExpiredAfterDays: 0", async () => {
    const { keys, time, expiredFor, revokedAt, remaining } = await setup({
      purgeExpiredAfterDays: 0,
    });

    const expired = await expiredFor("expired a year ago", 365);
    const revoked = await revokedAt("revoked");
    await time.travel(91, "days");
    await keys.purgeDeadKeys();

    expect(await remaining()).toEqual([expired]);
    expect(await remaining()).not.toContain(revoked);
  });

  it("disables the revoked window alone with purgeRevokedAfterDays: 0", async () => {
    const { keys, time, expiredFor, revokedAt, remaining } = await setup({
      purgeRevokedAfterDays: 0,
    });

    const expired = await expiredFor("expired a year ago", 365);
    const revoked = await revokedAt("revoked");
    await time.travel(91, "days");
    await keys.purgeDeadKeys();

    expect(await remaining()).toEqual([revoked]);
    expect(await remaining()).not.toContain(expired);
  });

  it("never touches an active key, however old", async () => {
    const { keys, time, userId, remaining } = await setup();

    const forever = await keys.create({ userId, name: "no expiry", roles: [] });
    const later = await keys.create({
      userId,
      name: "expires in ten years",
      roles: [],
      expiresAt: new Date(time.nowMillis() + 3650 * DAY),
    });
    await time.travel(400, "days");
    await keys.purgeDeadKeys();

    expect((await remaining()).sort()).toEqual(
      [forever.apiKey.id, later.apiKey.id].sort(),
    );
  });

  it("drains a backlog larger than one run across runs", async () => {
    const { expiredFor, remaining, keys, userId } = await setup(
      {},
      SmallBatchApiKeyService,
    );

    for (let i = 0; i < 23; i++) {
      await expiredFor(`backlog ${i}`, 200);
    }
    const active = await keys.create({ userId, name: "active", roles: [] });

    // Two a batch, ten batches a run: 20 go, 3 wait for the next run.
    const first = await keys.purgeDeadKeys();
    expect(first).toEqual({ expired: 20, revoked: 0 });
    expect(await remaining()).toHaveLength(4);

    expect(await keys.purgeDeadKeys()).toEqual({ expired: 3, revoked: 0 });
    expect(await remaining()).toEqual([active.apiKey.id]);
  });

  it("is a daily system job that runs the purge when triggered", async () => {
    // Without `travel()`: a cron fired on the way can still hold its run lock
    // when a trigger follows, and a skipped trigger reads as a purge that
    // deleted nothing.
    const { jobs, expiredFor, remaining } = await setup();
    await expiredFor("long dead", 200);

    expect(jobs.purgeExpired.name).toBe("system.keys.purge-expired");
    await jobs.purgeExpired.trigger();

    expect(await remaining()).toEqual([]);
  });
});
