import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { $job, AlephaApiJobs } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { LockProvider } from "alepha/lock";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { CronProvider } from "alepha/scheduler";
import { describe, it } from "vitest";

import { AlephaLockRedis, RedisLockProvider } from "../index.ts";

/**
 * Two apps on one Redis, told apart by `alepha.name` alone.
 */
describe("RedisLockProvider: one namespace per alepha.name", () => {
  const boot = async (name: string) => {
    const alepha = Alepha.create({ env: { APP_NAME: name } }).with(
      AlephaLockRedis,
    );
    await alepha.start();
    return alepha.inject(LockProvider);
  };

  it("should key every lock under <name>:lock:", ({ expect }) => {
    const alepha = Alepha.create({ env: { APP_NAME: "shop" } });

    expect(alepha.inject(RedisLockProvider).prefix("postgres:migrate")).toBe(
      "shop:lock:postgres:migrate",
    );
  });

  it("should not contend across names, and should within one", async ({
    expect,
  }) => {
    const name = `a-${randomUUID()}`;
    const holder = await boot(name);
    const sibling = await boot(name);
    const other = await boot(`b-${randomUUID()}`);
    const key = `lock-${randomUUID()}`;

    expect(await holder.set(key, "holder,1", true, 30_000)).toBe("holder,1");

    // The same name sees the held lock and does not take it...
    expect(await sibling.set(key, "sibling,1", true, 30_000)).toBe("holder,1");
    // ...another name takes its own.
    expect(await other.set(key, "other,1", true, 30_000)).toBe("other,1");

    await holder.del(key);
    expect(await other.get(key)).toBe("other,1");
    await other.del(key);
  });

  it("should let two apps with a cron of the same name both run the same instant", async ({
    expect,
  }) => {
    const runs: string[] = [];
    const jobName = `ns-app.tick-${randomUUID().slice(0, 8)}`;

    const make = async (name: string) => {
      class App {
        tick = $job({
          name: jobName,
          description: "A job under test.",
          cron: "0 0 * * *",
          handler: async () => {
            runs.push(name);
          },
        });
      }
      const alepha = Alepha.create({ env: { APP_NAME: name } })
        .with(AlephaLockRedis)
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);
      alepha.inject(App);
      await alepha.start();
      return alepha;
    };

    const a = `a-${randomUUID()}`;
    const appA = await make(a);
    const siblingA = await make(a);
    const appB = await make(`b-${randomUUID()}`);

    const instant = appA
      .inject(DateTimeProvider)
      .of("2026-01-01T00:00:00.000Z");
    const tick = (alepha: Alepha) =>
      alepha
        .inject(CronProvider)
        .getCronJobs()
        .find((job) => job.name === jobName)!
        .handler({ now: instant });

    await tick(appA);
    await tick(siblingA);
    await tick(appB);

    // One run per app: the sibling stood down on the instant appA claimed,
    // and appB's claim never saw appA's.
    expect(runs.sort()).toEqual([a, appB.name].sort());
  });
});
