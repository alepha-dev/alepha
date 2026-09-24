import { Alepha } from "alepha";
import { MemoryQueueProvider } from "alepha/queue";
import { describe, it } from "vitest";

import { MemoryCacheProvider } from "../providers/MemoryCacheProvider.ts";

/**
 * #Q2519: the memory cache and queue logged every call, and cleared the log
 * only on `reset()`: a long-running server using them grew its heap with
 * every request (a set call even holds the cached value). They record only
 * under test now.
 */
describe("memory providers keep no call log outside tests", () => {
  const boot = async (nodeEnv: string) => {
    const alepha = Alepha.create({ env: { NODE_ENV: nodeEnv } });
    const cache = alepha.inject(MemoryCacheProvider);
    const queue = alepha.inject(MemoryQueueProvider);
    await alepha.start();
    return { cache, queue };
  };

  it("records nothing in production, however many calls", async ({
    expect,
  }) => {
    const { cache, queue } = await boot("production");
    const value = new TextEncoder().encode("x".repeat(1024));

    for (let i = 0; i < 200; i++) {
      await cache.set("pages", `k${i}`, value);
      await cache.get("pages", `k${i}`);
      await cache.del("pages", `k${i}`);
      await queue.push("jobs", `m${i}`);
    }

    expect(cache.getCalls).toHaveLength(0);
    expect(cache.setCalls).toHaveLength(0);
    expect(cache.delCalls).toHaveLength(0);
    expect(queue.pushCalls).toHaveLength(0);
    // The provider still works: only the log is gone.
    expect(cache.stats().sets).toBe(200);
  });

  it("still records under test, which is what the helpers read", async ({
    expect,
  }) => {
    const { cache, queue } = await boot("test");

    await cache.set("pages", "k", new Uint8Array([1]));
    await queue.push("jobs", "m");

    expect(cache.wasSet("pages", "k")).toBe(true);
    expect(queue.wasEnqueued("jobs", "m")).toBe(true);
  });
});
