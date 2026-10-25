import { Alepha } from "alepha";
import { $cache, CacheProvider } from "alepha/cache";
import { describe, expect, it } from "vitest";

import {
  DatabaseCacheProvider,
  databaseCacheOptions,
} from "../providers/DatabaseCacheProvider.ts";

const make = (
  configure: (app: Alepha) => void = () => {},
): { alepha: Alepha; provider: () => DatabaseCacheProvider } => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  }).with({
    provide: CacheProvider,
    use: DatabaseCacheProvider,
  });
  configure(alepha);
  return {
    alepha,
    provider: () => alepha.inject(DatabaseCacheProvider),
  };
};

// ---------------------------------------------------------------------------------------------------------------------

describe("DatabaseCacheProvider — atomic incr", () => {
  it("increments through SQL upsert (no read/modify/write race)", async () => {
    const { alepha, provider } = make();
    await alepha.start();
    const p = provider();

    expect(await p.incr("counters", "k", 1)).toBe(1);
    expect(await p.incr("counters", "k", 1)).toBe(2);
    expect(await p.incr("counters", "k", 5)).toBe(7);
    expect(await p.incr("counters", "k", -3)).toBe(4);
  });

  it("survives concurrent increments without losing updates", async () => {
    const { alepha, provider } = make();
    await alepha.start();
    const p = provider();

    // SQLite serializes writes; this proves that even concurrent .incr()
    // calls all end up reflected in the final count, unlike the KV
    // read-modify-write race we want to avoid.
    const concurrent = 50;
    await Promise.all(
      Array.from({ length: concurrent }, () => p.incr("hits", "ip", 1)),
    );

    const bytes = await p.get("hits", "ip");
    const value = JSON.parse(new TextDecoder().decode(bytes!.subarray(1)));
    expect(value).toBe(concurrent);
  });

  it("reads back an incr'd value through get()", async () => {
    const { alepha, provider } = make();
    await alepha.start();
    const p = provider();

    await p.incr("counters", "k", 7);
    const bytes = await p.get("counters", "k");
    expect(bytes).toBeDefined();
    // JSON-encoded number with the JSON marker byte (0x02).
    expect(bytes![0]).toBe(0x02);
    expect(new TextDecoder().decode(bytes!.subarray(1))).toBe("7");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("DatabaseCacheProvider — lazy expiration on read", () => {
  it("returns undefined for an expired entry without sweeping it first", async () => {
    const { alepha, provider } = make();
    await alepha.start();
    const p = provider();

    // Write directly with a TTL of 1ms so the row is already expired by the
    // time we read it, regardless of clock granularity.
    await p.set("c", "k", new TextEncoder().encode("hello"), 1);
    await new Promise((r) => setTimeout(r, 5));

    expect(await p.get("c", "k")).toBeUndefined();
    expect(await p.has("c", "k")).toBe(false);
  });

  it("excludes expired entries from keys() and from get() but leaves them in storage until swept", async () => {
    const { alepha, provider } = make();
    await alepha.start();
    const p = provider();

    await p.set("c", "fresh", new TextEncoder().encode("a"));
    await p.set("c", "stale", new TextEncoder().encode("b"), 1);
    await new Promise((r) => setTimeout(r, 5));

    expect(await p.keys("c")).toEqual(["fresh"]);
    expect(await p.has("c", "stale")).toBe(false);

    // The expired row is still on disk until sweep runs; correctness is
    // preserved by the read-time filter, not by aggressive cleanup.
    const rows = await (p as any).repository.findMany({});
    expect(rows.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("DatabaseCacheProvider — opportunistic sweep", () => {
  it("does nothing when sweepProbability is 0", async () => {
    const { alepha, provider } = make((app) => {
      app.store.mut(databaseCacheOptions, (cur) => ({
        ...cur,
        sweepProbability: 0,
      }));
    });
    await alepha.start();
    const p = provider();

    for (let i = 0; i < 30; i++) {
      await p.set("c", `k${i}`, new TextEncoder().encode("x"));
    }
    expect(p.sweeps).toBe(0);
  });

  it("triggers a sweep on every write when sweepProbability is 1", async () => {
    const { alepha, provider } = make((app) => {
      app.store.mut(databaseCacheOptions, (cur) => ({
        ...cur,
        sweepProbability: 1,
      }));
    });
    await alepha.start();
    const p = provider();

    await p.set("c", "fresh", new TextEncoder().encode("a"));
    await p.set("c", "stale", new TextEncoder().encode("b"), 1);
    await new Promise((r) => setTimeout(r, 5));

    // Trigger another write; the stale row should be reaped during the sweep.
    await p.set("c", "trigger", new TextEncoder().encode("c"));
    expect(p.sweeps).toBeGreaterThan(0);

    // Nothing references the swept row anymore.
    expect(await p.has("c", "stale")).toBe(false);
  });

  it("sweepExpired() reaps every expired row in one shot", async () => {
    const { alepha, provider } = make((app) => {
      app.store.mut(databaseCacheOptions, (cur) => ({
        ...cur,
        sweepProbability: 0,
      }));
    });
    await alepha.start();
    const p = provider();

    for (let i = 0; i < 5; i++) {
      await p.set("c", `stale${i}`, new TextEncoder().encode("x"), 1);
    }
    await p.set("c", "fresh", new TextEncoder().encode("y"));
    await new Promise((r) => setTimeout(r, 5));

    const reaped = await p.sweepExpired();
    expect(reaped).toBe(5);

    // Sanity: the live entry is intact.
    expect(await p.has("c", "fresh")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("DatabaseCacheProvider — provider option on $cache", () => {
  it("$cache({ provider: DatabaseCacheProvider }) routes to the SQL backend even when the default CacheProvider is something else", async () => {
    class App {
      // Default fallback CacheProvider is MemoryCacheProvider in this test.
      pinned = $cache<string>({
        provider: DatabaseCacheProvider,
      });
    }

    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    // Note: NO substitution of CacheProvider — the framework default is in
    // play. The pinned `$cache` should still reach DatabaseCacheProvider via
    // the explicit option.
    const app = alepha.inject(App);
    await alepha.start();

    await app.pinned.set("k", "v");
    expect(await app.pinned.get("k")).toBe("v");

    // The row really lives in the cache_entries table, not in
    // MemoryCacheProvider's map.
    const rows = await (
      alepha.inject(DatabaseCacheProvider) as any
    ).repository.findMany({});
    expect(rows.length).toBe(1);
    expect(rows[0].cacheKey).toBe("k");
  });
});
