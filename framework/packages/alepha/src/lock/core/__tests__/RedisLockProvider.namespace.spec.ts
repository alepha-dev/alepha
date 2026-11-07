import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaLock, LockProvider } from "alepha/lock";
import { describe, it } from "vitest";

import { RedisLockProvider } from "../index.ts";

// The shared test env sets no REDIS_URL, so nothing else turns Redis on; this
// file runs against the compose `redis` service (16379, CI's port too). A
// test file runs in its own process, so this reaches no other file.
process.env.REDIS_URL ??= "redis://localhost:16379";

/**
 * Two apps on one Redis, told apart by `alepha.name` alone. Every container
 * here registers only `AlephaLock`: `REDIS_URL` is what selects Redis, so two
 * containers of one name never hold one lock at once. (A `$job` cron tick is
 * claimed in the database since #Q3185, so it no longer goes through here.)
 */
describe("RedisLockProvider: one namespace per alepha.name", () => {
  const boot = async (name: string) => {
    const alepha = Alepha.create({ env: { APP_NAME: name } }).with(AlephaLock);
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
});
