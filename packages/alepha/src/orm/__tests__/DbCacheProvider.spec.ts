import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { DbCacheProvider } from "../core/providers/DbCacheProvider.ts";

class TestDbCacheProvider extends DbCacheProvider {
  public size(): number {
    return this.store.size;
  }
  public keys(): string[] {
    return [...this.store.keys()];
  }
}

const boot = async () => {
  const alepha = Alepha.create();
  const cache = alepha.inject(TestDbCacheProvider);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  return { cache, dateTime };
};

describe("DbCacheProvider", () => {
  it("should evict the oldest entry once the capacity is reached", async () => {
    const { cache } = await boot();

    for (let i = 0; i < DbCacheProvider.MAX_ENTRIES + 10; i++) {
      await cache.set("t", `k${i}`, i);
    }

    expect(cache.size()).toBeLessThanOrEqual(DbCacheProvider.MAX_ENTRIES);
    // The very first keys are gone, the most recent survive.
    expect(await cache.get("t", "k0")).toBeUndefined();
    expect(await cache.get("t", `k${DbCacheProvider.MAX_ENTRIES + 9}`)).toBe(
      DbCacheProvider.MAX_ENTRIES + 9,
    );
  });

  it("should drop expired entries without needing them to be read", async () => {
    const { cache, dateTime } = await boot();
    dateTime.pause();

    await cache.set("t", "short", 1, 1_000);
    await cache.set("t", "long", 2, 3_600_000);
    expect(cache.size()).toBe(2);

    dateTime.travel(60_000);
    // A write is the sweep trigger — nothing reads "short" ever again.
    await cache.set("t", "other", 3, 3_600_000);

    expect(cache.keys()).not.toContain("t:short");
    expect(await cache.get("t", "long")).toBe(2);
  });

  it("should still serve a live entry", async () => {
    const { cache } = await boot();
    await cache.set("users", "findMany:{}", ["a"]);
    expect(await cache.get("users", "findMany:{}")).toEqual(["a"]);
  });

  it("should still invalidate a whole table", async () => {
    const { cache } = await boot();
    await cache.set("users", "a", 1);
    await cache.set("orders", "a", 2);

    await cache.invalidateTable("users");

    expect(await cache.get("users", "a")).toBeUndefined();
    expect(await cache.get("orders", "a")).toBe(2);
  });
});
