import { Alepha } from "alepha";
import { AlephaCache, CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";
import { ServerRateLimitProvider } from "../index.ts";

/**
 * Every counter key embeds its fixed window, so a new key is minted each
 * window. Without a TTL none of them is ever reclaimed: the memory provider
 * grows without bound, and Redis/D1 keep a key per (identity, window) forever.
 * `CacheProvider.incr` documents the requirement — the limiter has to honour it.
 */

class RecordingCache extends MemoryCacheProvider {
  public incrCalls: Array<{ key: string; ttl?: number }> = [];

  public override async incr(
    name: string,
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number> {
    this.incrCalls.push({ key, ttl });
    return super.incr(name, key, amount, ttl);
  }
}

const boot = async () => {
  const alepha = Alepha.create()
    // Substituted before the module binds its own default.
    .with({ provide: CacheProvider, use: RecordingCache })
    .with(AlephaCache);
  const provider = alepha.inject(ServerRateLimitProvider);
  const cache = alepha.inject(RecordingCache);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  return { alepha, provider, cache, dateTime };
};

describe("rate-limit counters expire", () => {
  it("should arm a TTL on every counter it writes", async () => {
    const { provider, cache } = await boot();

    await provider.checkLimitByKey("ip:1.2.3.4", { max: 5, windowMs: 60_000 });

    expect(cache.incrCalls).toHaveLength(1);
    expect(cache.incrCalls[0].ttl).toBeGreaterThanOrEqual(60_000);
  });

  it("should not retain a previous window's counter", async () => {
    const { provider, cache, dateTime } = await boot();
    dateTime.pause();

    await provider.checkLimitByKey("ip:1.2.3.4", { max: 5, windowMs: 60_000 });
    const firstKey = cache.incrCalls[0].key;

    dateTime.travel(3_600_000);
    await provider.checkLimitByKey("ip:1.2.3.4", { max: 5, windowMs: 60_000 });

    expect(cache.incrCalls[1].key).not.toBe(firstKey);
    expect(await cache.has("rate-limit", firstKey)).toBe(false);
  });

  it("should arm a TTL on a refund too", async () => {
    const { provider, cache } = await boot();

    const result = await provider.checkLimitByKey("ip:5.6.7.8", {
      max: 5,
      windowMs: 60_000,
    });
    await provider.refund(
      result,
      { max: 5, windowMs: 60_000, skipSuccessfulRequests: true },
      { failed: false },
    );

    expect(cache.incrCalls).toHaveLength(2);
    expect(cache.incrCalls[1].ttl).toBeGreaterThanOrEqual(60_000);
  });

  it("should still count and block within a window", async () => {
    const { provider } = await boot();

    const opts = { max: 2, windowMs: 60_000 };
    expect((await provider.checkLimitByKey("ip:9", opts)).allowed).toBe(true);
    expect((await provider.checkLimitByKey("ip:9", opts)).allowed).toBe(true);
    expect((await provider.checkLimitByKey("ip:9", opts)).allowed).toBe(false);
  });
});
