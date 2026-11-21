import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import {
  $cache,
  type CachePrimitive,
  type CachePrimitiveOptions,
  CacheProvider,
  MemoryCacheProvider,
} from "../index.ts";

/**
 * Wait for the background refreshes of a cache to finish, failed or not:
 * their handler has run, the value is written, the key is free again.
 */
const settleRefreshes = (cache: CachePrimitive) =>
  Promise.allSettled(cache["inflightRefreshes"].values());

/**
 * Tests for stale-while-revalidate (`stale` option).
 *
 * After `ttl` expires, the cached value remains servable for `stale`
 * longer; reads in the grace window return the stale value immediately
 * and trigger ONE background refresh (single-flight per key).
 */
describe("$cache stale-while-revalidate (SWR)", () => {
  it("returns fresh value without scheduling a refresh", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
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
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    await time.travel([3, "seconds"]); // still fresh
    expect(await app.cache()).toBe("v:1");
    expect(await app.cache()).toBe("v:1");
    expect(calls).toBe(1);
  });

  it("does not unwrap user data with the `v` and `f` keys of an envelope", async () => {
    // Only the reserved `__alepha_swr_envelope__` key marks an envelope: an
    // object that merely has its other keys, or a shorter marker of its own,
    // is user data and must round-trip intact.
    const suspicious = { __swr: 1, v: "inner", f: 5 };
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        handler: async () => suspicious,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    expect(await app.cache()).toEqual(suspicious);
    // Second read comes from the cache: must still be the full object.
    expect(await app.cache()).toEqual(suspicious);
  });

  it("unwraps user data that carries the reserved envelope key", async () => {
    // The limit of the marker: a value with `__alepha_swr_envelope__: 1`,
    // `v` and `f` cannot be told from an envelope once stored, so a read
    // from the store answers its `v`. The key is reserved.
    const collision = { __alepha_swr_envelope__: 1, v: "inner", f: 0 };
    class App {
      cache = $cache<unknown>({ ttl: [5, "seconds"] });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    await alepha.start();

    await app.cache.set("k", collision);

    expect(await app.cache.get("k")).toBe("inner");
  });

  it("round-trips Uint8Array values through the SWR envelope", async () => {
    const binary = new Uint8Array([0x00, 0x7f, 0x80, 0xff]);
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
        handler: async () => binary,
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBeInstanceOf(Uint8Array);

    // A stale read, past the fresh deadline, must also decode back to the
    // original bytes, not a JSON-mangled plain object.
    await time.travel([40, "seconds"]);
    const cached = await app.cache();
    expect(cached).toBeInstanceOf(Uint8Array);
    expect(Array.from(cached as Uint8Array)).toEqual([0x00, 0x7f, 0x80, 0xff]);
  });

  it("returns stale value and schedules a background refresh", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
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
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    await time.travel([10, "seconds"]); // past ttl, within stale

    // Stale value served immediately
    expect(await app.cache()).toBe("v:1");

    // Wait for background refresh to complete
    await settleRefreshes(app.cache);

    expect(calls).toBe(2);
    // Next read returns the refreshed value
    expect(await app.cache()).toBe("v:2");
  });

  it("single-flight: concurrent stale reads trigger one refresh", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
        handler: async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 10));
          return `v:${calls}`;
        },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    await time.travel([10, "seconds"]);

    // 10 concurrent reads
    const results = await Promise.all(
      Array.from({ length: 10 }, () => app.cache()),
    );
    expect(results.every((r) => r === "v:1")).toBe(true);

    await settleRefreshes(app.cache);
    expect(calls).toBe(2); // 1 original + 1 background refresh
  });

  it("single-flight: concurrent cold reads trigger one handler call", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
        handler: async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 10));
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

    const results = await Promise.all(
      Array.from({ length: 10 }, () => app.cache()),
    );
    expect(results.every((r) => r === "v:1")).toBe(true);
    expect(calls).toBe(1);
  });

  it("preserves stale value when background refresh fails", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
        handler: async () => {
          calls++;
          if (calls > 1) {
            throw new Error("upstream down");
          }
          return `v:${calls}`;
        },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    await time.travel([10, "seconds"]);

    // Stale read should succeed even though refresh fails in background.
    expect(await app.cache()).toBe("v:1");

    // Wait for failed refresh
    await settleRefreshes(app.cache);
    expect(calls).toBe(2);

    // Next read returns stale value again, attempts another refresh.
    expect(await app.cache()).toBe("v:1");
    await settleRefreshes(app.cache);
    expect(calls).toBe(3);
  });

  it("treats values past ttl + stale as miss (synchronous handler call)", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [10, "seconds"],
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
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");

    // Past ttl + stale -> provider expires the entry entirely
    await time.travel([20, "seconds"]);

    expect(await app.cache()).toBe("v:2");
    expect(calls).toBe(2);
  });

  it("set() resets the fresh deadline and clears pending refresh", async () => {
    let calls = 0;
    class App {
      cache = $cache<string>({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
        handler: () => {
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
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    await time.travel([10, "seconds"]); // stale

    await app.cache.set(app.cache.key(), "manual");
    // After manual set, fresh again -> no refresh needed
    expect(await app.cache()).toBe("manual");
    expect(await app.cache()).toBe("manual");
    expect(calls).toBe(1); // handler never called for refresh
  });

  it("composes with L1 memory tier", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [10, "minutes"],
        stale: [1, "hour"],
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
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    const getsAfterFirst = provider.getCalls.length;

    // L1 serves the next reads.
    expect(await app.cache()).toBe("v:1");
    expect(await app.cache()).toBe("v:1");
    expect(provider.getCalls.length).toBe(getsAfterFirst);
    expect(calls).toBe(1);
  });

  it("retries a failed refresh on the next stale read, with an L1 tier", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
        memory: true,
        handler: async () => {
          calls++;
          if (calls > 1) {
            throw new AlephaError("upstream down");
          }
          return `v:${calls}`;
        },
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    await time.travel([10, "seconds"]);

    // L1 has expired: the provider answers with the stale value, and the
    // refresh it schedules fails.
    expect(await app.cache()).toBe("v:1");
    await settleRefreshes(app.cache);
    expect(calls).toBe(2);

    // The value is still stale, so this read schedules another refresh.
    expect(await app.cache()).toBe("v:1");
    await settleRefreshes(app.cache);
    expect(calls).toBe(3);
  });

  it("an L1 entry copied from the provider ends at the fresh deadline", async () => {
    // Two caches on one container stand in for two processes: `writer`
    // stores the value, `reader` only ever sees it through the provider.
    const options: CachePrimitiveOptions<string> = {
      name: "swr-backfill",
      ttl: [5, "seconds"],
      stale: [1, "hour"],
      memory: { ttl: [1, "minute"] },
    };
    class App {
      writer = $cache<string>({ ...options });
      reader = $cache<string>({ ...options });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    await app.writer.set("k", "v");
    await time.travel([4, "seconds"]);
    expect(await app.reader.read("k")).toEqual({ value: "v", stale: false });

    // Past the fresh deadline, inside `memory.ttl`: the reader has to say
    // the value is stale, or no refresh is ever scheduled for it.
    await time.travel([30, "seconds"]);
    expect(await app.reader.read("k")).toEqual({ value: "v", stale: true });
  });

  it("works in middleware mode (handler from the pipeline)", async () => {
    let calls = 0;
    class App {
      cache = $cache<string>({
        name: "mw-swr",
        ttl: [5, "seconds"],
        stale: [1, "hour"],
      });
      fn = this.cache(async (id: string) => {
        calls++;
        return `v:${id}:${calls}`;
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.fn("a")).toBe("v:a:1");
    await time.travel([10, "seconds"]);

    // Stale served + background refresh
    expect(await app.fn("a")).toBe("v:a:1");
    await settleRefreshes(app.cache);
    expect(calls).toBe(2);
    expect(await app.fn("a")).toBe("v:a:2");
  });

  it("emits cache:staleServed and cache:revalidated events", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
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
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    const staleEvents: string[] = [];
    const revalidateEvents: string[] = [];
    alepha.events.on("cache:staleServed", (e) => {
      staleEvents.push(e.key);
    });
    alepha.events.on("cache:revalidated", (e) => {
      revalidateEvents.push(e.key);
    });

    await app.cache();
    await time.travel([10, "seconds"]);
    await app.cache();

    await settleRefreshes(app.cache);

    expect(staleEvents.length).toBeGreaterThanOrEqual(1);
    expect(revalidateEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("manual mode (cache.get without handler) returns stale value but does not refresh", async () => {
    class App {
      cache = $cache<string>({
        ttl: [5, "seconds"],
        stale: [1, "hour"],
      });
    }

    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const app = alepha.inject(App);
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    await app.cache.set("k", "value");
    await time.travel([10, "seconds"]);

    // Stale served. No refresh possible (no handler).
    expect(await app.cache.get("k")).toBe("value");
    expect(await app.cache.get("k")).toBe("value");
  });

  it("stale option off behaves like a regular cache", async () => {
    let calls = 0;
    class App {
      cache = $cache({
        ttl: [5, "seconds"],
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
    const time = alepha.inject(DateTimeProvider);
    await alepha.start();

    expect(await app.cache()).toBe("v:1");
    await time.travel([3, "seconds"]);
    expect(await app.cache()).toBe("v:1");

    // After ttl, no stale window -> immediate handler call
    await time.travel([3, "seconds"]);
    expect(await app.cache()).toBe("v:2");
  });
});
