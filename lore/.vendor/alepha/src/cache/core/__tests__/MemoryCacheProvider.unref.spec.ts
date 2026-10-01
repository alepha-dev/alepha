import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { MemoryCacheProvider } from "../providers/MemoryCacheProvider.ts";

/**
 * Reaches into `store` because the event-loop reference is the whole subject
 * and there is no public surface carrying it. The alternative — asserting that
 * a process exits — is a 5-minute test.
 */
class TestMemoryCacheProvider extends MemoryCacheProvider {
  public timerOf(name: string, key: string): any {
    return this.store[name]?.[key]?.timeout?.timer;
  }
}

/**
 * The CI symptom this pins: `lore quality push` pushed in 3.2s and then
 * held the runner for 5 more minutes. `HttpClient` caches any GET carrying an
 * `etag`, `$cache` gave it the 300s default TTL, and the refed eviction timer
 * kept Node's event loop alive for the whole of it — once per push, in front of
 * every deploy gated on that job.
 */
describe("MemoryCacheProvider eviction timers", () => {
  const create = async () => {
    const alepha = Alepha.create();
    const cache = alepha.inject(TestMemoryCacheProvider);
    await alepha.start();
    return cache;
  };

  it("should not hold the event loop open for a TTL entry", async ({
    expect,
  }) => {
    const cache = await create();

    await cache.set("ns", "key", new TextEncoder().encode("value"), 300_000);

    expect(cache.timerOf("ns", "key").hasRef()).toBe(false);
  });

  it("should not hold the event loop open for a counter window", async ({
    expect,
  }) => {
    const cache = await create();

    await cache.incr("ns", "counter", 1, 300_000);

    expect(cache.timerOf("ns", "counter").hasRef()).toBe(false);
  });

  it("should still evict when the TTL elapses", async ({ expect }) => {
    const cache = await create();

    await cache.set("ns", "key", new TextEncoder().encode("value"), 20);
    expect(await cache.get("ns", "key")).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await cache.get("ns", "key")).toBeUndefined();
  });
});
