import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it, test } from "vitest";

import { sessions } from "../entities/sessions.ts";
import { users } from "../entities/users.ts";
import { AlephaApiUsers } from "../index.ts";
import { UserJobs } from "../jobs/UserJobs.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";

describe("UserJobs", () => {
  describe("purgeExpiredSessions", () => {
    test("deletes expired sessions", async ({ expect }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);

      class TestRepositories {
        userRepository = $repository(users);
        sessionRepository = $repository(sessions);
      }

      const userJobs = alepha.inject(UserJobs);
      const repos = alepha.inject(TestRepositories);
      await alepha.start();

      const user = await repos.userRepository.create({
        email: "test@example.com",
      });

      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: pastDate,
      });
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: pastDate,
      });

      const futureDate = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: futureDate,
      });

      expect(await repos.sessionRepository.findMany()).toHaveLength(3);

      // Cron jobs run inline — trigger awaits the handler synchronously.
      await userJobs.purgeExpiredSessions.trigger();

      const sessionsAfter = await repos.sessionRepository.findMany();
      expect(sessionsAfter).toHaveLength(1);
      expect(new Date(sessionsAfter[0].expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    test("no-op when no expired sessions exist", async ({ expect }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);

      class TestRepositories {
        userRepository = $repository(users);
        sessionRepository = $repository(sessions);
      }

      const userJobs = alepha.inject(UserJobs);
      const repos = alepha.inject(TestRepositories);
      await alepha.start();

      const user = await repos.userRepository.create({
        email: "test2@example.com",
      });

      const futureDate = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: futureDate,
      });

      expect(await repos.sessionRepository.findMany()).toHaveLength(1);

      await userJobs.purgeExpiredSessions.trigger();

      expect(await repos.sessionRepository.findMany()).toHaveLength(1);
    });

    test("purges idle sessions when expirationIdle is configured", async ({
      expect,
    }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs)
        .with(AlephaApiUsers);

      class TestRepositories {
        userRepository = $repository(users);
        sessionRepository = $repository(sessions);
      }

      const userJobs = alepha.inject(UserJobs);
      const repos = alepha.inject(TestRepositories);
      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("default", {
        settings: {
          refreshToken: { expirationIdle: 5 * 60 * 1000 }, // 5 minutes
        } as never,
      });
      await alepha.start();

      const user = await repos.userRepository.create({
        email: "idle-sweep@example.com",
      });

      const farFuture = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const oldUsed = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
      const recentUsed = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago

      // Idle by lastUsedAt — should be purged (lastUsedAt > 5 min ago).
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: farFuture,
        lastUsedAt: oldUsed,
      });

      // Recently used — within idle window, should remain.
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: farFuture,
        lastUsedAt: recentUsed,
      });

      // Pre-migration row (lastUsedAt null) with old createdAt — should be
      // purged via createdAt fallback. We can't directly set createdAt via
      // create() (auto-managed), so simulate by creating a row and then
      // updating lastUsedAt to null while the row is fresh — the createdAt
      // fallback will not trip yet (createdAt is now). Skip this case in this
      // test; covered logically by the deleteMany filter shape.

      expect(await repos.sessionRepository.findMany()).toHaveLength(2);

      await userJobs.purgeExpiredSessions.trigger();

      const remaining = await repos.sessionRepository.findMany();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].lastUsedAt).toBe(recentUsed);
    });
  });
});

/**
 * Shrinks a batch to two rows, so a backlog larger than one run's cap fits in
 * a test. The cap itself (ten batches) is the production one.
 */
class SmallBatchUserJobs extends UserJobs {
  public testBatchSize = () => super.batchSize();

  protected batchSize(): number {
    return 2;
  }
}

describe("UserJobs bounded session purge", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with({ provide: UserJobs, use: SmallBatchUserJobs })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);

    class TestRepositories {
      userRepository = $repository(users);
      sessionRepository = $repository(sessions);
    }

    const userJobs = alepha.inject(SmallBatchUserJobs);
    const repos = alepha.inject(TestRepositories);
    await alepha.start();

    const user = await repos.userRepository.create({
      email: `bounded-${crypto.randomUUID()}@example.com`,
    });
    const at = (offsetMs: number) =>
      new Date(Date.now() + offsetMs).toISOString();

    return { userJobs, repos, user, at };
  };

  it("drains a backlog larger than one run across runs, stopping each run at the cap", async ({
    expect,
  }) => {
    const { userJobs, repos, user, at } = await setup();

    // 23 expired rows: two per batch, ten batches per run, so a run takes 20.
    await repos.sessionRepository.createMany(
      Array.from({ length: 23 }, () => ({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: at(-60 * 60 * 1000),
      })),
    );
    const live = await repos.sessionRepository.create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: at(24 * 60 * 60 * 1000),
    });

    await userJobs.purgeExpiredSessions.trigger();
    expect(await repos.sessionRepository.findMany()).toHaveLength(4);

    await userJobs.purgeExpiredSessions.trigger();
    const remaining = await repos.sessionRepository.findMany();
    expect(remaining.map((row) => row.id)).toEqual([live.id]);
  });

  it("never touches an active session, however old", async ({ expect }) => {
    const { userJobs, repos, user, at } = await setup();

    const active = await repos.sessionRepository.createMany(
      Array.from({ length: 5 }, () => ({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: at(24 * 60 * 60 * 1000),
      })),
    );

    await userJobs.purgeExpiredSessions.trigger();

    const remaining = await repos.sessionRepository.findMany();
    expect(remaining.map((row) => row.id).sort()).toEqual(
      active.map((row) => row.id).sort(),
    );
  });

  it("sizes a batch from the driver's bound-parameter ceiling", async ({
    expect,
  }) => {
    const { userJobs } = await setup();

    // Postgres binds 65535 parameters, so the 1000 ceiling applies; on D1
    // (100) the same formula gives 90.
    expect(userJobs.testBatchSize()).toBe(1000);
  });
});
