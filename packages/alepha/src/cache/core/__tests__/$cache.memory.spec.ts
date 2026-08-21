import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { $cache, CacheProvider, MemoryCacheProvider } from "../index.ts";

/**
 * Tests for the in-process L1 memory tier (`memory` option).
 *
 * The L1 tier sits in front of the configured `CacheProvider`. Reads check
 * memory first; writes are write-through to both tiers. The L1 store is
 * per-primitive and uses lazy expiry + LRU eviction.
 *
 * In these tests, the L2 provider is also a fresh MemoryCacheProvider —
 * but it's a *separate* instance from the inline L1 Map inside the
 * primitive, so we can distinguish hits clearly via `provider.getCalls`.
 */
describe("$cache memory tier (L1)", () => {
  it("serves repeated reads from L1 without hitting the provider", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "minutes"],
        memory: true,
        handler: async (id: string) => {
          calls++;
          return `v:${id}`;
        },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    await alepha.start();

    expect(await app.cache("a")).toBe("v:a");
    const providerGetsAfterFirst = provider.getCalls.length;
    expect(calls).toBe(1);

    // Subsequent reads should hit L1 — no new provider gets.
    expect(await app.cache("a")).toBe("v:a");
    expect(await app.cache("a")).toBe("v:a");
    expect(await app.cache("a")).toBe("v:a");
    expect(provider.getCalls.length).toBe(providerGetsAfterFirst);
    expect(calls).toBe(1);
  });

  it("write-through populates both L1 and provider", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: true,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    await alepha.start();

    await app.cache.set("k", "hello");

    // Provider got the write
    expect(provider.wasSet("App:cache", "k")).toBe(true);

    // Subsequent read serves from L1 (no provider get call).
    const getsBefore = provider.getCalls.length;
    expect(await app.cache.get("k")).toBe("hello");
    expect(provider.getCalls.length).toBe(getsBefore);
  });

  it("falls back to provider when L1 expires", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [10, "minutes"],
        memory: { ttl: [5, "seconds"] },
        handler: async () => {
          calls++;
          return `v:${calls}`;
        },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    expect(calls).toBe(1);

    // L1 still valid
    await time.travel([3, "seconds"]);
    const getsBeforeExpire = provider.getCalls.length;
    expect(await app.cache()).toBe("v:1");
    expect(provider.getCalls.length).toBe(getsBeforeExpire);

    // L1 expired but L2 still valid — fallback to provider, no handler call
    await time.travel([3, "seconds"]);
    expect(await app.cache()).toBe("v:1");
    expect(provider.getCalls.length).toBeGreaterThan(getsBeforeExpire);
    expect(calls).toBe(1);
  });

  it("uses default L1 TTL = min(ttl, 30s) when memory: true", async () => {
    class App {
      shortTtl = $cache<string>({
        ttl: [5, "seconds"],
        memory: true,
      });
      longTtl = $cache<string>({
        ttl: [10, "minutes"],
        memory: true,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    expect((app.shortTtl as any).memoryTtlMs).toBe(5_000);
    expect((app.longTtl as any).memoryTtlMs).toBe(30_000);
  });

  it("evicts oldest entries when L1 exceeds `max`", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: { max: 3 },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    await alepha.start();

    await app.cache.set("a", "A");
    await app.cache.set("b", "B");
    await app.cache.set("c", "C");
    await app.cache.set("d", "D"); // should evict "a" from L1

    // "a" reads should now miss L1 and hit provider
    const getsBefore = provider.getCalls.length;
    expect(await app.cache.get("a")).toBe("A"); // hits provider
    expect(provider.getCalls.length).toBe(getsBefore + 1);

    // "d" reads hit L1
    const getsAfterA = provider.getCalls.length;
    expect(await app.cache.get("d")).toBe("D");
    expect(provider.getCalls.length).toBe(getsAfterA);
  });

  it("LRU touch on read keeps recent entries", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: { max: 3 },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    await alepha.start();

    await app.cache.set("a", "A");
    await app.cache.set("b", "B");
    await app.cache.set("c", "C");

    // touch "a" -> moves it to end
    expect(await app.cache.get("a")).toBe("A");

    // now insert "d" -> should evict "b" (least recently used), not "a"
    await app.cache.set("d", "D");

    const getsBefore = provider.getCalls.length;
    expect(await app.cache.get("a")).toBe("A"); // still in L1
    expect(provider.getCalls.length).toBe(getsBefore);

    expect(await app.cache.get("b")).toBe("B"); // miss L1, hit provider
    expect(provider.getCalls.length).toBe(getsBefore + 1);
  });

  it("caches provider misses with `negative` option", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: { negative: [2, "seconds"] },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache.get("nope")).toBeUndefined();
    const getsAfterFirst = provider.getCalls.length;

    // Second miss read short-circuited via negative cache
    expect(await app.cache.get("nope")).toBeUndefined();
    expect(provider.getCalls.length).toBe(getsAfterFirst);

    // After negative TTL expires, provider is consulted again
    await time.travel([3, "seconds"]);
    expect(await app.cache.get("nope")).toBeUndefined();
    expect(provider.getCalls.length).toBeGreaterThan(getsAfterFirst);
  });

  it("set() replaces a negative cache entry", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: { negative: [10, "seconds"] },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.cache.get("k")).toBeUndefined();
    await app.cache.set("k", "value");
    expect(await app.cache.get("k")).toBe("value");
  });

  it("invalidate(key) clears both L1 and provider", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: true,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    await alepha.start();

    await app.cache.set("k", "v");
    await app.cache.invalidate("k");

    expect(await provider.has("App:cache", "k")).toBe(false);
    expect(await app.cache.get("k")).toBeUndefined();
  });

  it("invalidate() with no keys clears all of L1", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: true,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    await app.cache.set("a", "A");
    await app.cache.set("b", "B");
    await app.cache.invalidate();

    expect(await app.cache.get("a")).toBeUndefined();
    expect(await app.cache.get("b")).toBeUndefined();
  });

  it("invalidate(prefix*) wildcard clears matching L1 entries", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: true,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    await app.cache.set("user:1", "A");
    await app.cache.set("user:2", "B");
    await app.cache.set("post:1", "C");

    await app.cache.invalidate("user:*");

    expect(await app.cache.get("user:1")).toBeUndefined();
    expect(await app.cache.get("user:2")).toBeUndefined();
    expect(await app.cache.get("post:1")).toBe("C");
  });

  it("incr() invalidates the L1 entry", async () => {
    class App {
      counter = $cache<number>({
        ttl: [5, "minutes"],
        memory: true,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.counter.incr("hits")).toBe(1);
    // After incr, the provider has 1; L1 should be empty so the next get
    // pulls the fresh value rather than an outdated L1 entry.
    expect(await app.counter.get("hits")).toBe(1);
    expect(await app.counter.incr("hits", 5)).toBe(6);
    expect(await app.counter.get("hits")).toBe(6);
  });

  it("works in middleware mode (pipeline use:[cache])", async () => {
    class App {
      calls = 0;
      cache = $cache<string>({
        name: "mw-mem",
        ttl: [5, "minutes"],
        memory: true,
      });
      fn = async (id: string) => {
        const wrapped = this.cache(async (i: string) => {
          this.calls++;
          return `v:${i}`;
        });
        return wrapped(id);
      };
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const provider = alepha.inject(CacheProvider) as MemoryCacheProvider;
    await alepha.start();

    expect(await app.fn("a")).toBe("v:a");
    const getsAfterFirst = provider.getCalls.length;
    expect(await app.fn("a")).toBe("v:a");
    expect(await app.fn("a")).toBe("v:a");
    // L1 takes over — no new provider gets
    expect(provider.getCalls.length).toBe(getsAfterFirst);
    expect(app.calls).toBe(1);
  });

  it("emits cache:hit on L1 read", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "minutes"],
        memory: true,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    const hits: string[] = [];
    alepha.events.on("cache:hit", (e) => {
      hits.push(e.key);
    });

    await app.cache.set("k", "v");
    await app.cache.get("k");
    await app.cache.get("k");

    expect(hits).toContain("k");
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("memory option off (undefined) does not allocate an L1 store", () => {
    class App {
      cache = $cache<string>({ ttl: [5, "minutes"] });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);

    expect((app.cache as any).memoryStore).toBeUndefined();
  });

  it("respects disabled option even with memory L1", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        disabled: true,
        memory: true,
        handler: async () => {
          calls++;
          return `v:${calls}`;
        },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    expect(await app.cache()).toBe("v:2");
    expect(await app.cache()).toBe("v:3");
  });
});
