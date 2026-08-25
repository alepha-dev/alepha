import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaLock, LockProvider } from "alepha/lock";
import { RedisTopicProvider } from "alepha/topic/redis";
import { describe, expect, test } from "vitest";

import {
  testDelIfOwner,
  testLockBasic,
  testLockGracePeriod,
  testLockWait,
} from "../../core/__tests__/shared.ts";
import { RedisLockProvider } from "../index.ts";

/**
 * The inherited read-compare-delete, kept reachable so the race below can be
 * run against both implementations, plus a hook at the exact point the window
 * opens: after the value has been read, before the delete is sent.
 */
class TwoStepRedisLockProvider extends RedisLockProvider {
  public onRead?: () => Promise<void>;

  public override async get(key: string): Promise<string | undefined> {
    const value = await super.get(key);
    const hook = this.onRead;
    this.onRead = undefined;
    await hook?.();
    return value;
  }

  public override delIfOwner(key: string, ownerId: string): Promise<boolean> {
    return LockProvider.prototype.delIfOwner.call(this, key, ownerId);
  }
}

/**
 * Counts the two calls the inherited release is built from. The atomic one
 * makes neither, which is what "no window" means in practice.
 */
class CountingRedisLockProvider extends RedisLockProvider {
  public reads = 0;
  public deletes = 0;

  public override get(key: string): Promise<string | undefined> {
    this.reads += 1;
    return super.get(key);
  }

  public override del(...keys: string[]): Promise<void> {
    this.deletes += 1;
    return super.del(...keys);
  }
}

describe("RedisLockProvider", () => {
  const Provider = RedisLockProvider;
  const TopicProvider = RedisTopicProvider;

  const boot = async (provider: typeof RedisLockProvider) => {
    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: provider })
      .with(AlephaLock);
    const lock = alepha.inject(LockProvider);
    await alepha.start();
    return lock;
  };

  test("should lock without waiting", async () => {
    await testLockBasic(Provider, TopicProvider);
  });

  test("should lock with waiting", async () => {
    await testLockWait(Provider, TopicProvider);
  });

  test("should lock with grace period", async () => {
    await testLockGracePeriod(Provider, TopicProvider);
  });

  test("delIfOwner only deletes the caller's own lock", async () => {
    await testDelIfOwner(Provider);
  });

  test("the two-step release deletes a lock taken over mid-release", async () => {
    const lock = (await boot(
      TwoStepRedisLockProvider,
    )) as TwoStepRedisLockProvider;
    const key = `lock-race-${randomUUID()}`;

    await lock.set(key, `owner-1,${new Date().toISOString()}`, true, 30_000);

    // owner-1's lock expires and owner-2 takes it, in the gap between the
    // read and the delete.
    lock.onRead = async () => {
      await lock.del(key);
      await lock.set(key, `owner-2,${new Date().toISOString()}`, true, 30_000);
    };

    expect(await lock.delIfOwner(key, "owner-1")).toBe(true);

    // owner-2 believes it holds the lock, and nothing does.
    expect(await lock.get(key)).toBeUndefined();
  });

  test("delIfOwner releases in one command, leaving no window", async () => {
    const lock = (await boot(
      CountingRedisLockProvider,
    )) as CountingRedisLockProvider;
    const key = `lock-race-${randomUUID()}`;

    await lock.set(key, `owner-1,${new Date().toISOString()}`, true, 30_000);
    lock.reads = 0;
    lock.deletes = 0;

    expect(await lock.delIfOwner(key, "owner-1")).toBe(true);

    // Read before the assertion below adds one of its own. The window in the
    // test above is exactly the gap between these two calls, so the release
    // must issue neither: the compare and the delete travel as a single Lua
    // script that Redis runs to completion before anything else.
    const [reads, deletes] = [lock.reads, lock.deletes];
    expect(await lock.get(key)).toBeUndefined();

    expect(reads).toBe(0);
    expect(deletes).toBe(0);
  });

  test("delIfOwner leaves the lock alone once another owner holds it", async () => {
    const lock = await boot(RedisLockProvider);
    const key = `lock-race-${randomUUID()}`;

    await lock.set(key, `owner-2,${new Date().toISOString()}`, true, 30_000);

    expect(await lock.delIfOwner(key, "owner-1")).toBe(false);
    expect(await lock.get(key)).toContain("owner-2");

    await lock.del(key);
  });
});
