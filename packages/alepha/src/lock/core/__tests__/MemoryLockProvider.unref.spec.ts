import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { MemoryLockProvider } from "../providers/MemoryLockProvider.ts";

/**
 * Reaches into `storeTimeout` because the event-loop reference is the whole
 * subject and there is no public surface carrying it. The alternative -
 * asserting that a process exits - is a 5-minute test.
 */
class TestMemoryLockProvider extends MemoryLockProvider {
  public timerOf(key: string): any {
    return this.storeTimeout[key]?.timer;
  }
}

/**
 * Same shape as the cache eviction leak: `$lock` arms an expiry timer for the
 * whole `maxDuration` (5 minutes by default) on acquisition, and `gracePeriod`
 * re-arms one for a period meant to outlive the run entirely. Both callbacks
 * only `delete` an in-memory key, so refed they held the process open long
 * after its work was done.
 */
describe("MemoryLockProvider expiry timers", () => {
  const create = async () => {
    const alepha = Alepha.create();
    const lock = alepha.inject(TestMemoryLockProvider);
    await alepha.start();
    return lock;
  };

  it("should not hold the event loop open for a lock lease", async ({
    expect,
  }) => {
    const lock = await create();

    await lock.set("job", "owner-1", true, 300_000);

    expect(lock.timerOf("job").hasRef()).toBe(false);
  });

  it("should not hold the event loop open for a grace period", async ({
    expect,
  }) => {
    const lock = await create();

    await lock.set("job", "owner-1", true, 300_000);
    await lock.set("job", "owner-1,ended", false, 86_400_000);

    expect(lock.timerOf("job").hasRef()).toBe(false);
  });

  it("should still expire the key when the lease elapses", async ({
    expect,
  }) => {
    const lock = await create();

    await lock.set("job", "owner-1", true, 20);
    expect(await lock.get("job")).toBe("owner-1");

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await lock.get("job")).toBeUndefined();
  });
});
