import { $pipeline, Alepha } from "alepha";
import { describe, test } from "vitest";

import { AlephaCache } from "../index.ts";
import { $cache } from "../primitives/$cache.ts";

describe("$cache middleware", () => {
  test("caches handler result", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCache);

    let calls = 0;
    class TestService {
      fn = $pipeline({
        use: [$cache({ name: "test-mw", ttl: [5, "minutes"] })],
        handler: async (id: string) => {
          calls++;
          return `result:${id}`;
        },
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    expect(await svc.fn("a")).toBe("result:a");
    expect(await svc.fn("a")).toBe("result:a");
    expect(calls).toBe(1);

    // Different arg = different cache key
    expect(await svc.fn("b")).toBe("result:b");
    expect(calls).toBe(2);

    await alepha.stop();
  });

  test("passes handler arguments through", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCache);

    class TestService {
      fn = $pipeline({
        use: [$cache({ name: "test-passthrough", ttl: [5, "minutes"] })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    expect(await svc.fn(3, 4)).toBe(7);

    await alepha.stop();
  });

  test("is also a store (get, set, invalidate)", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCache);

    class TestService {
      myCache = $cache<string>({ name: "test-store", ttl: [5, "minutes"] });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    await svc.myCache.set("key1", "value1");
    expect(await svc.myCache.get("key1")).toBe("value1");

    await svc.myCache.invalidate("key1");
    expect(await svc.myCache.get("key1")).toBeUndefined();

    await alepha.stop();
  });

  test("can be used as both middleware and store", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCache);

    let calls = 0;
    class TestService {
      userCache = $cache<string>({
        name: "test-dual",
        ttl: [5, "minutes"],
      });

      getUser = $pipeline({
        use: [this.userCache],
        handler: async (id: string) => {
          calls++;
          return `user:${id}`;
        },
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    // Middleware caches the result
    expect(await svc.getUser("1")).toBe("user:1");
    expect(await svc.getUser("1")).toBe("user:1");
    expect(calls).toBe(1);

    // Store can invalidate
    await svc.userCache.invalidate();
    expect(await svc.getUser("1")).toBe("user:1");
    expect(calls).toBe(2);

    await alepha.stop();
  });

  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCache);

    class TestService {
      fn = $pipeline({
        use: [$cache({ name: "test-meta", ttl: [5, "minutes"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$cache");
  });

  test("custom key function", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCache);

    let calls = 0;
    class TestService {
      fn = $pipeline({
        use: [
          $cache({
            name: "test-key",
            ttl: [5, "minutes"],
            key: (id: string, _ignored: string) => id,
          }),
        ],
        handler: async (id: string, extra: string) => {
          calls++;
          return `${id}:${extra}`;
        },
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    expect(await svc.fn("a", "x")).toBe("a:x");
    // Same id, different extra — same cache key
    expect(await svc.fn("a", "y")).toBe("a:x");
    expect(calls).toBe(1);

    await alepha.stop();
  });
});
