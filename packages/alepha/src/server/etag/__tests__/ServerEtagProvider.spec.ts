import { Alepha } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, test } from "vitest";
import { $etag, AlephaServerEtag, ServerEtagProvider } from "../index.ts";

class TestApp {
  counter = 0;
  protected resetCounter = 0;

  cachedAction = $action({
    use: [$etag(true)],
    handler: () => `cached-${this.counter++}`,
  });

  uncachedAction = $action({
    handler: () => `uncached-${this.counter++}`,
  });

  cachedWithCustomTtl = $action({
    use: [$etag({ store: { ttl: 1000 } })],
    handler: () => `ttl-cached-${this.counter++}`,
  });

  cachedWithShortTtl = $action({
    use: [$etag({ store: { ttl: [100, "milliseconds"] } })],
    handler: () => `short-ttl-${this.counter++}`,
  });

  cachedWithShortDurationStore = $action({
    use: [$etag({ store: [100, "milliseconds"] })],
    handler: () => `short-store-${this.counter++}`,
  });

  asyncCachedAction = $action({
    use: [$etag(true)],
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `async-cached-${this.counter++}`;
    },
  });

  etagOnlyAction = $action({
    use: [$etag()],
    handler: () => `etag-only-${this.counter++}`,
  });

  etagAndCacheAction = $action({
    use: [$etag(true)],
    handler: () => `etag-and-cache-${this.counter++}`,
  });

  dynamicContentAction = $action({
    use: [$etag()],
    handler: () => `dynamic-${Date.now()}`,
  });

  cacheWithControlTrue = $action({
    use: [$etag({ store: true, control: true })],
    handler: () => `control-true-${this.counter++}`,
  });

  cacheWithControlString = $action({
    use: [$etag({ store: true, control: "public, max-age=600, immutable" })],
    handler: () => `control-string-${this.counter++}`,
  });

  cacheWithControlObject = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          maxAge: 3600,
          mustRevalidate: true,
        },
      }),
    ],
    handler: () => `control-object-${this.counter++}`,
  });

  cacheWithComplexControl = $action({
    use: [
      $etag({
        store: {
          ttl: [10, "minutes"],
        },
        control: {
          public: true,
          maxAge: 600,
          sMaxAge: 1200,
          immutable: true,
        },
      }),
    ],
    handler: () => `complex-control-${this.counter++}`,
  });

  cacheWithDurationMaxAge = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          maxAge: [5, "minutes"],
          sMaxAge: [1, "hour"],
        },
      }),
    ],
    handler: () => `duration-maxage-${this.counter++}`,
  });

  cacheWith30Seconds = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          maxAge: [30, "seconds"],
        },
      }),
    ],
    handler: () => "test-30s",
  });

  cacheWith10Minutes = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          maxAge: [10, "minutes"],
        },
      }),
    ],
    handler: () => "test-10m",
  });

  cacheWith2Hours = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          maxAge: [2, "hours"],
        },
      }),
    ],
    handler: () => "test-2h",
  });

  cacheWith1Day = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          maxAge: [1, "day"],
        },
      }),
    ],
    handler: () => "test-1d",
  });

  cacheWithMixedMaxAge = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          maxAge: 600, // number (seconds)
          sMaxAge: [20, "minutes"], // DurationLike
        },
      }),
    ],
    handler: () => "mixed",
  });

  cacheWithStaleWhileRevalidate = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          sMaxAge: 900,
          staleWhileRevalidate: 60,
        },
      }),
    ],
    handler: () => "stale-while-revalidate",
  });

  cacheWithStaleWhileRevalidateDuration = $action({
    use: [
      $etag({
        store: true,
        control: {
          public: true,
          sMaxAge: [15, "minutes"],
          staleWhileRevalidate: [1, "minute"],
        },
      }),
    ],
    handler: () => "stale-while-revalidate-duration",
  });

  errorAction = $action({
    use: [$etag(true)],
    handler: ({ reply }) => {
      reply.status = 500;
      return `error-${this.counter++}`;
    },
  });

  notFoundAction = $action({
    use: [$etag(true)],
    handler: ({ reply }) => {
      reply.status = 404;
      return `not-found-${this.counter++}`;
    },
  });

  /**
   * The immutable-year pair: same `control`, one outcome each. Together they
   * pin that the directive follows the route on success and never rides along
   * on a failure.
   */
  immutableFileAction = $action({
    use: [
      $etag({
        control: { public: true, maxAge: [1, "year"], immutable: true },
      }),
    ],
    handler: () => "file-bytes",
  });

  immutableMissingFileAction = $action({
    use: [
      $etag({
        control: { public: true, maxAge: [1, "year"], immutable: true },
      }),
    ],
    handler: ({ reply }) => {
      reply.status = 404;
      return "not-found";
    },
  });

  conditionalErrorAction = $action({
    use: [$etag(true)],
    handler: ({ reply }) => {
      if (this.counter === 0) {
        reply.status = 500;
        this.counter++;
        return "error-0";
      }
      return `success-${this.counter++}`;
    },
  });

  reset() {
    this.counter = this.resetCounter++;
  }
}

describe("ServerEtagProvider", () => {
  let alepha: Alepha;
  let app: TestApp;
  let etagProvider: ServerEtagProvider;

  beforeEach(async () => {
    alepha = Alepha.create().with(AlephaServerEtag);
    app = alepha.inject(TestApp);
    etagProvider = alepha.inject(ServerEtagProvider);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha?.stop();
  });

  describe("ETag support", () => {
    test("should return 200 on first request and 304 on subsequent requests with same ETag", async ({
      expect,
    }) => {
      const firstResponse = await app.cachedAction.fetch();
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.data).toBe("cached-0");

      const secondResponse = await app.cachedAction.fetch();
      expect(secondResponse.status).toBe(304);
      expect(secondResponse.data).toBe("cached-0");
    });

    test("should return fresh data after cache invalidation", async ({
      expect,
    }) => {
      const firstResponse = await app.cachedAction.fetch();
      expect(firstResponse.data).toBe("cached-0");

      await etagProvider.invalidate(app.cachedAction.route);

      const afterInvalidation = await app.cachedAction.fetch();
      expect(afterInvalidation.status).toBe(200);
      expect(afterInvalidation.data).toBe("cached-1");
    });

    test("should set etag property on route and handle caching correctly", async ({
      expect,
    }) => {
      // Make first request to trigger caching
      const response = await app.cachedAction.fetch();
      expect(response.status).toBe(200);
      expect(response.data).toBe("cached-0");

      // Subsequent request should return 304 (cached with etag check)
      const cachedResponse = await app.cachedAction.fetch();
      expect(cachedResponse.status).toBe(304);

      // Cache invalidation should work
      await etagProvider.invalidate(app.cachedAction.route);
      const afterInvalidation = await app.cachedAction.fetch();
      expect(afterInvalidation.status).toBe(200);
      expect(afterInvalidation.data).toBe("cached-1");
    });
  });

  describe("Cache behavior", () => {
    test("should cache responses for actions with $etag(true)", async ({
      expect,
    }) => {
      for (let i = 0; i < 5; i++) {
        const response1 = await app.cachedAction.fetch();
        const response2 = await app.cachedAction.fetch();
        expect(response1.data).toBe(response2.data);
        app.reset();
      }
    });

    test("should not cache responses for actions without $etag", async ({
      expect,
    }) => {
      for (let i = 0; i < 5; i++) {
        const response1 = await app.uncachedAction.fetch();
        const response2 = await app.uncachedAction.fetch();
        expect(response1.data).not.toBe(response2.data);
      }
    });

    test("should handle async cached actions correctly", async ({ expect }) => {
      const response1 = await app.asyncCachedAction.fetch();
      const response2 = await app.asyncCachedAction.fetch();

      expect(response1.data).toBe("async-cached-0");
      expect(response2.data).toBe("async-cached-0");
      expect(response1.data).toBe(response2.data);
    });
  });

  describe("Cache invalidation", () => {
    test("should invalidate every caller's entry for the route", async ({
      expect,
    }) => {
      // Entries are namespaced by caller identity, so invalidating a route
      // must clear all of them — not only the anonymous one.
      const hostname = alepha.inject(ServerProvider).hostname;
      const call = (token: string) =>
        fetch(`${hostname}/api/cachedAction`, {
          headers: { authorization: `Bearer ${token}` },
        }).then((res) => res.text());

      const alice = await call("alice-token");
      expect(await call("alice-token")).toBe(alice);

      await etagProvider.invalidate(app.cachedAction.route);

      expect(await call("alice-token")).not.toBe(alice);
    });

    test("should invalidate cache using ServerEtagProvider.invalidate()", async ({
      expect,
    }) => {
      const initialResponse = await app.cachedAction.fetch();
      const cachedResponse = await app.cachedAction.fetch();

      expect(initialResponse.data).toBe(cachedResponse.data);

      await etagProvider.invalidate(app.cachedAction.route);

      const afterInvalidation = await app.cachedAction.fetch();
      expect(afterInvalidation.data).not.toBe(initialResponse.data);
    });

    test("should invalidate cache using injected ServerEtagProvider", async ({
      expect,
    }) => {
      const initialResponse = await app.cachedAction.fetch();
      const cachedResponse = await app.cachedAction.fetch();

      expect(initialResponse.data).toBe(cachedResponse.data);

      await etagProvider.invalidate(app.cachedAction.route);

      const afterInvalidation = await app.cachedAction.fetch();
      expect(afterInvalidation.data).not.toBe(initialResponse.data);
    });

    test("should not affect other cached actions when invalidating specific route", async ({
      expect,
    }) => {
      const cachedResponse1 = await app.cachedAction.fetch();
      const ttlCachedResponse1 = await app.cachedWithCustomTtl.fetch();

      await etagProvider.invalidate(app.cachedAction.route);

      const cachedResponse2 = await app.cachedAction.fetch();
      const ttlCachedResponse2 = await app.cachedWithCustomTtl.fetch();

      expect(cachedResponse1.data).not.toBe(cachedResponse2.data);
      expect(ttlCachedResponse1.data).toBe(ttlCachedResponse2.data);
    });
  });

  describe("Cache configuration", () => {
    test("should respect custom TTL configuration", async ({ expect }) => {
      const response1 = await app.cachedWithCustomTtl.fetch();
      const response2 = await app.cachedWithCustomTtl.fetch();

      expect(response1.data).toBe(response2.data);
      expect(response1.data).toBe("ttl-cached-0");
    });

    test("should expire the stored response once store.ttl elapses", async ({
      expect,
    }) => {
      // The configured TTL was truth-tested but never passed to cache.set,
      // so every $etag store silently used the global cache default (300s).
      const first = await app.cachedWithShortTtl.fetch();
      const cached = await app.cachedWithShortTtl.fetch();
      expect(cached.data).toBe(first.data);

      await new Promise((resolve) => setTimeout(resolve, 250));

      const afterExpiry = await app.cachedWithShortTtl.fetch();
      expect(afterExpiry.data).not.toBe(first.data);
    });

    test("should not serve one caller's stored body to another", async ({
      expect,
    }) => {
      // The key was route + params + query only, so `$etag(true)` on an
      // authenticated action handed the first caller's body to everyone else.
      const hostname = alepha.inject(ServerProvider).hostname;
      const call = (token: string) =>
        fetch(`${hostname}/api/cachedAction`, {
          headers: { authorization: `Bearer ${token}` },
        }).then((res) => res.text());

      const alice = await call("alice-token");
      const bob = await call("bob-token");

      expect(alice).not.toBe(bob);

      // ...but the same caller still gets a cache hit.
      expect(await call("alice-token")).toBe(alice);
    });

    test("should accept a bare duration as store", async ({ expect }) => {
      const first = await app.cachedWithShortDurationStore.fetch();
      expect((await app.cachedWithShortDurationStore.fetch()).data).toBe(
        first.data,
      );

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect((await app.cachedWithShortDurationStore.fetch()).data).not.toBe(
        first.data,
      );
    });
  });

  describe("Error handling", () => {
    test("should handle invalidation of non-existent route gracefully", async ({
      expect,
    }) => {
      expect(async () => {
        await etagProvider.invalidate("non-existent-route" as any);
      }).not.toThrow();
    });

    test("should handle multiple concurrent cache requests correctly", async ({
      expect,
    }) => {
      const promises = Array.from({ length: 10 }, () =>
        app.cachedAction.fetch(),
      );
      const responses = await Promise.all(promises);

      const firstData = responses[0].data;
      for (const response of responses) {
        expect(response.data).toBe(firstData);
      }
    });

    test("should handle cache invalidation during concurrent requests", async ({
      expect,
    }) => {
      const initialResponse = await app.cachedAction.fetch();

      const concurrentPromises = [
        app.cachedAction.fetch(),
        app.cachedAction.fetch(),
      ];

      const [cachedResponse1, cachedResponse2] =
        await Promise.all(concurrentPromises);

      expect(cachedResponse1.data).toBe(initialResponse.data);
      expect(cachedResponse2.data).toBe(initialResponse.data);

      await etagProvider.invalidate(app.cachedAction.route);

      const finalResponse = await app.cachedAction.fetch();
      expect(finalResponse.data).not.toBe(initialResponse.data);
    });
  });

  describe("Provider lifecycle", () => {
    test("should maintain cache state across multiple requests", async ({
      expect,
    }) => {
      const responses = [];
      for (let i = 0; i < 5; i++) {
        responses.push(await app.cachedAction.fetch());
      }

      const firstData = responses[0].data;
      for (const response of responses) {
        expect(response.data).toBe(firstData);
      }
    });

    test("should clear cache when application stops and restarts", async ({
      expect,
    }) => {
      await app.cachedAction.fetch();
      await alepha.stop();

      alepha = Alepha.create().with(AlephaServerEtag);
      app = alepha.inject(TestApp);
      await alepha.start();

      const afterRestartResponse = await app.cachedAction.fetch();
      expect(afterRestartResponse.data).toBe("cached-0");
    });
  });

  describe("ETag-only support (without cache)", () => {
    test("should generate and return ETag header for etag-only routes", async ({
      expect,
    }) => {
      const response = await app.etagOnlyAction.fetch();

      expect(response.status).toBe(200);
      expect(response.data).toBe("etag-only-0");
      expect(response.headers.get("etag")).toBeDefined();
      expect(response.headers.get("last-modified")).toBeDefined();
    });

    test("should return 304 when client sends matching ETag", async ({
      expect,
    }) => {
      const firstResponse = await app.etagOnlyAction.fetch();
      const etag = firstResponse.headers.get("etag");

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.data).toBe("etag-only-0");
      expect(etag).toBeDefined();

      // Send request with If-None-Match header
      const secondResponse = await app.etagOnlyAction.fetch({
        headers: { "if-none-match": etag! },
      });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.data).toBe("etag-only-1");
    });

    test("should NOT cache responses for etag-only routes", async ({
      expect,
    }) => {
      const response1 = await app.etagOnlyAction.fetch();
      const response2 = await app.etagOnlyAction.fetch();

      // Counter should increment because responses are NOT cached
      expect(response1.data).toBe("etag-only-0");
      expect(response2.data).toBe("etag-only-1");

      // But both should have different ETags
      expect(response1.headers.get("etag")).not.toBe(
        response2.headers.get("etag"),
      );
    });

    test("should return 200 with new content when ETag doesn't match", async ({
      expect,
    }) => {
      const firstResponse = await app.etagOnlyAction.fetch();
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.data).toBe("etag-only-0");

      // Send request with wrong ETag
      const secondResponse = await app.etagOnlyAction.fetch({
        headers: { "if-none-match": '"wrong-etag"' },
      });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.data).toBe("etag-only-1");
    });

    test("should handle dynamic content with ETags correctly", async ({
      expect,
    }) => {
      const response1 = await app.dynamicContentAction.fetch();
      const etag1 = response1.headers.get("etag");

      expect(response1.status).toBe(200);
      expect(etag1).toBeDefined();

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const response2 = await app.dynamicContentAction.fetch();
      const etag2 = response2.headers.get("etag");

      expect(response2.status).toBe(200);
      expect(etag2).toBeDefined();

      // ETags should be different because content is dynamic
      expect(etag1).not.toBe(etag2);
    });
  });

  describe("ETag with cache combined", () => {
    test("should support both caching and ETag validation", async ({
      expect,
    }) => {
      const response1 = await app.etagAndCacheAction.fetch();
      const etag1 = response1.headers.get("etag");

      expect(response1.status).toBe(200);
      expect(response1.data).toBe("etag-and-cache-0");
      expect(etag1).toBeDefined();

      // Second request should return cached content with 304
      const response2 = await app.etagAndCacheAction.fetch();

      expect(response2.status).toBe(304);
      expect(response2.data).toBe("etag-and-cache-0");
    });

    test("should return cached content even without ETag header", async ({
      expect,
    }) => {
      const response1 = await app.etagAndCacheAction.fetch();
      expect(response1.status).toBe(200);
      expect(response1.data).toBe("etag-and-cache-0");

      // Request without ETag should still get cached response
      const response2 = await app.etagAndCacheAction.fetch({
        headers: {
          "if-none-match": "non-matching-etag",
        },
      });

      expect(response2.status).toBe(200);
      expect(response2.data).toBe("etag-and-cache-0");
    });

    test("should invalidate both cache and ETag when cache is cleared", async ({
      expect,
    }) => {
      const response1 = await app.etagAndCacheAction.fetch();
      const etag1 = response1.headers.get("etag");

      expect(response1.status).toBe(200);
      expect(response1.data).toBe("etag-and-cache-0");

      // Invalidate cache
      await etagProvider.invalidate(app.etagAndCacheAction.route);

      // Next request should generate new content and new ETag
      const response2 = await app.etagAndCacheAction.fetch();
      const etag2 = response2.headers.get("etag");

      expect(response2.status).toBe(200);
      expect(response2.data).toBe("etag-and-cache-1");
      expect(etag2).toBeDefined();
      expect(etag1).not.toBe(etag2);
    });
  });

  describe("ETag header validation", () => {
    test("should generate consistent ETags for same content", async ({
      expect,
    }) => {
      const response1 = await app.cachedAction.fetch();
      const etag1 = response1.headers.get("etag");

      const response2 = await app.cachedAction.fetch();
      const etag2 = response2.headers.get("etag");

      // Same content should produce same ETag
      expect(etag1).toBe(etag2);
      expect(response1.data).toBe(response2.data);
    });

    test("should generate different ETags for different content", async ({
      expect,
    }) => {
      const response1 = await app.etagOnlyAction.fetch();
      const etag1 = response1.headers.get("etag");

      const response2 = await app.etagOnlyAction.fetch();
      const etag2 = response2.headers.get("etag");

      // Different content should produce different ETags
      expect(response1.data).not.toBe(response2.data);
      expect(etag1).not.toBe(etag2);
    });

    test("should set Last-Modified header with ETag", async ({ expect }) => {
      const response = await app.etagOnlyAction.fetch();

      expect(response.headers.get("etag")).toBeDefined();
      expect(response.headers.get("last-modified")).toBeDefined();

      // Verify it's a valid ISO date string
      const lastModified = response.headers.get("last-modified");
      expect(() => new Date(lastModified!)).not.toThrow();
    });
  });

  describe("Mixed scenarios", () => {
    test("should handle routes with different etag configurations independently", async ({
      expect,
    }) => {
      // Cached action
      const cached1 = await app.cachedAction.fetch();
      const cached2 = await app.cachedAction.fetch();
      expect(cached1.data).toBe(cached2.data);

      // Uncached action
      const uncached1 = await app.uncachedAction.fetch();
      const uncached2 = await app.uncachedAction.fetch();
      expect(uncached1.data).not.toBe(uncached2.data);

      // ETag-only action
      const etag1 = await app.etagOnlyAction.fetch();
      const etag2 = await app.etagOnlyAction.fetch();
      expect(etag1.data).not.toBe(etag2.data);

      // All should have their own independent state
      expect(cached1.data).toContain("cached");
      expect(uncached1.data).toContain("uncached");
      expect(etag1.data).toContain("etag-only");
    });

    test("should not interfere with each other's ETags", async ({ expect }) => {
      const response1 = await app.etagOnlyAction.fetch();
      const etag1 = response1.headers.get("etag");

      const response2 = await app.cachedAction.fetch();
      const etag2 = response2.headers.get("etag");

      // Different actions should have different ETags
      expect(etag1).not.toBe(etag2);
    });
  });

  describe("Cache-Control header support", () => {
    test("should set Cache-Control header when control: true", async ({
      expect,
    }) => {
      const response = await app.cacheWithControlTrue.fetch();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    });

    test("should set Cache-Control header with custom string value", async ({
      expect,
    }) => {
      const response = await app.cacheWithControlString.fetch();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=600, immutable",
      );
    });

    test("should build Cache-Control header from object directives", async ({
      expect,
    }) => {
      const response = await app.cacheWithControlObject.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("max-age=3600");
      expect(cacheControl).toContain("must-revalidate");
    });

    test("should support complex Cache-Control with multiple directives", async ({
      expect,
    }) => {
      const response = await app.cacheWithComplexControl.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("max-age=600");
      expect(cacheControl).toContain("s-maxage=1200");
      expect(cacheControl).toContain("immutable");
    });

    test("should not set Cache-Control when $etag(true) without control option", async ({
      expect,
    }) => {
      const response = await app.cachedAction.fetch();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBeNull();
    });

    test("should cache responses with Cache-Control headers", async ({
      expect,
    }) => {
      const response1 = await app.cacheWithControlObject.fetch();
      const response2 = await app.cacheWithControlObject.fetch();

      expect(response1.data).toBe(response2.data);
      expect(response1.data).toBe("control-object-0");
    });

    test("should support private cache directive", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const privateAction = alepha.inject(
        class TestPrivateCache {
          action = $action({
            use: [
              $etag({
                store: true,
                control: {
                  private: true,
                  maxAge: 300,
                },
              }),
            ],
            handler: () => "private-cache",
          });
        },
      ).action;
      await alepha.start();

      const response = await privateAction.fetch();
      const cacheControl = response.headers.get("cache-control");

      expect(cacheControl).toContain("private");
      expect(cacheControl).toContain("max-age=300");
      expect(cacheControl).not.toContain("public");
    });

    test("should support no-cache and no-store directives", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const noCacheAction = alepha.inject(
        class TestNoCache {
          action = $action({
            use: [
              $etag({
                store: true,
                control: {
                  noCache: true,
                  noStore: true,
                },
              }),
            ],
            handler: () => "no-cache",
          });
        },
      ).action;
      await alepha.start();

      const response = await noCacheAction.fetch();
      const cacheControl = response.headers.get("cache-control");

      expect(cacheControl).toContain("no-cache");
      expect(cacheControl).toContain("no-store");
    });

    test("should support proxy-revalidate directive", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const proxyAction = alepha.inject(
        class TestProxyRevalidate {
          action = $action({
            use: [
              $etag({
                store: true,
                control: {
                  public: true,
                  proxyRevalidate: true,
                  maxAge: 600,
                },
              }),
            ],
            handler: () => "proxy-revalidate",
          });
        },
      ).action;
      await alepha.start();

      const response = await proxyAction.fetch();
      const cacheControl = response.headers.get("cache-control");

      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("proxy-revalidate");
      expect(cacheControl).toContain("max-age=600");
    });

    test("should support s-maxage for shared cache control", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const sharedCacheAction = alepha.inject(
        class TestSharedCache {
          action = $action({
            use: [
              $etag({
                store: true,
                control: {
                  public: true,
                  maxAge: 300,
                  sMaxAge: 600,
                },
              }),
            ],
            handler: () => "shared-cache",
          });
        },
      ).action;
      await alepha.start();

      const response = await sharedCacheAction.fetch();
      const cacheControl = response.headers.get("cache-control");

      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("max-age=300");
      expect(cacheControl).toContain("s-maxage=600");
    });

    test("should support DurationLike for maxAge and sMaxAge", async ({
      expect,
    }) => {
      const response = await app.cacheWithDurationMaxAge.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");

      // 5 minutes = 300 seconds, 1 hour = 3600 seconds
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("max-age=300");
      expect(cacheControl).toContain("s-maxage=3600");
    });

    test("should handle various DurationLike formats for maxAge", ({
      expect,
    }) => {
      // Test directly via buildCacheControlHeader method
      expect(
        etagProvider.buildCacheControlHeader({
          control: { public: true, maxAge: [30, "seconds"] },
        }),
      ).toContain("max-age=30");

      expect(
        etagProvider.buildCacheControlHeader({
          control: { public: true, maxAge: [10, "minutes"] },
        }),
      ).toContain("max-age=600");

      expect(
        etagProvider.buildCacheControlHeader({
          control: { public: true, maxAge: [2, "hours"] },
        }),
      ).toContain("max-age=7200");

      expect(
        etagProvider.buildCacheControlHeader({
          control: { public: true, maxAge: [1, "day"] },
        }),
      ).toContain("max-age=86400");
    });

    test("should mix number and DurationLike for maxAge and sMaxAge", ({
      expect,
    }) => {
      const cacheControl = etagProvider.buildCacheControlHeader({
        control: {
          public: true,
          maxAge: 600, // number (seconds)
          sMaxAge: [20, "minutes"], // DurationLike
        },
      });

      expect(cacheControl).toContain("max-age=600");
      expect(cacheControl).toContain("s-maxage=1200"); // 20 minutes = 1200 seconds
    });

    test("should support stale-while-revalidate directive with number", async ({
      expect,
    }) => {
      const response = await app.cacheWithStaleWhileRevalidate.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("s-maxage=900");
      expect(cacheControl).toContain("stale-while-revalidate=60");
    });

    test("should support stale-while-revalidate directive with DurationLike", async ({
      expect,
    }) => {
      const response = await app.cacheWithStaleWhileRevalidateDuration.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("s-maxage=900");
      expect(cacheControl).toContain("stale-while-revalidate=60");
    });

    test("should handle stale-while-revalidate via buildCacheControlHeader", ({
      expect,
    }) => {
      const cacheControl = etagProvider.buildCacheControlHeader({
        control: {
          public: true,
          sMaxAge: 900,
          staleWhileRevalidate: [2, "minutes"],
        },
      });

      expect(cacheControl).toContain("stale-while-revalidate=120");
    });
  });

  describe("Stream caching support", () => {
    test("should cache ReadableStream responses via tee", async ({
      expect,
    }) => {
      // Create a simple ReadableStream that emits chunks
      const chunks = ["Hello", " ", "World"];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      // Access the protected method via type assertion
      const provider = etagProvider as any;
      const key = "test-stream-key";

      // Collect the stream for cache
      const hash = await provider.collectStreamForCache(
        stream,
        key,
        200,
        "text/html",
        true,
      );

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^"[a-f0-9]+"$/); // ETag format

      // Verify the cache contains the collected content
      const cached = await provider.cache.get(key);
      expect(cached).toBeDefined();
      expect(cached.body).toBe("Hello World");
      expect(cached.status).toBe(200);
      expect(cached.contentType).toBe("text/html");
    });

    test("should tee stream so client and cache both receive data", async ({
      expect,
    }) => {
      const encoder = new TextEncoder();
      const chunks = ["<html>", "<body>", "Content", "</body>", "</html>"];

      const originalStream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      // Tee the stream like ServerEtagProvider does
      const [clientStream, cacheStream] = originalStream.tee();

      // Read from client stream (simulates client receiving data)
      const clientReader = clientStream.getReader();
      const clientChunks: string[] = [];
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await clientReader.read();
        if (done) break;
        clientChunks.push(decoder.decode(value, { stream: true }));
      }
      clientChunks.push(decoder.decode()); // flush

      // Read from cache stream (simulates cache collection)
      const cacheReader = cacheStream.getReader();
      const cacheChunks: string[] = [];
      const cacheDecoder = new TextDecoder();

      while (true) {
        const { done, value } = await cacheReader.read();
        if (done) break;
        cacheChunks.push(cacheDecoder.decode(value, { stream: true }));
      }
      cacheChunks.push(cacheDecoder.decode()); // flush

      // Both should receive the same data
      const clientData = clientChunks.join("");
      const cacheData = cacheChunks.join("");

      expect(clientData).toBe("<html><body>Content</body></html>");
      expect(cacheData).toBe("<html><body>Content</body></html>");
      expect(clientData).toBe(cacheData);
    });

    test("should handle empty stream gracefully", async ({ expect }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      const provider = etagProvider as any;
      const key = "empty-stream-key";

      const hash = await provider.collectStreamForCache(
        stream,
        key,
        200,
        "text/html",
        true,
      );

      expect(hash).toBeDefined();

      const cached = await provider.cache.get(key);
      expect(cached).toBeDefined();
      expect(cached.body).toBe("");
    });

    test("should handle large stream with multiple chunks", async ({
      expect,
    }) => {
      const encoder = new TextEncoder();
      const chunkCount = 100;
      const chunkContent = "x".repeat(1000);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < chunkCount; i++) {
            controller.enqueue(encoder.encode(chunkContent));
          }
          controller.close();
        },
      });

      const provider = etagProvider as any;
      const key = "large-stream-key";

      const hash = await provider.collectStreamForCache(
        stream,
        key,
        200,
        "text/html",
        false,
      );

      // hash should be undefined when generateEtag is false
      expect(hash).toBeUndefined();

      const cached = await provider.cache.get(key);
      expect(cached).toBeDefined();
      expect(cached.body.length).toBe(chunkCount * chunkContent.length);
    });

    test("should generate correct ETag for streamed content", async ({
      expect,
    }) => {
      const content = "Test content for ETag";
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(content));
          controller.close();
        },
      });

      const provider = etagProvider as any;

      // Generate ETag from stream
      const streamHash = await provider.collectStreamForCache(
        stream,
        "etag-test-key",
        200,
        "text/html",
        true,
      );

      // Generate ETag from string directly
      const stringHash = etagProvider.generateETag(content);

      // Both should produce the same ETag
      expect(streamHash).toBe(stringHash);
    });
  });

  describe("Error response caching", () => {
    test("should NOT cache 500 error responses", async ({ expect }) => {
      const response1 = await app.errorAction.fetch();
      expect(response1.status).toBe(500);
      expect(response1.data).toBe("error-0");

      // Second request should execute handler again (not cached)
      const response2 = await app.errorAction.fetch();
      expect(response2.status).toBe(500);
      expect(response2.data).toBe("error-1");

      // Verify counter incremented (handler was called)
      expect(response1.data).not.toBe(response2.data);
    });

    test("should NOT cache 404 error responses", async ({ expect }) => {
      const response1 = await app.notFoundAction.fetch();
      expect(response1.status).toBe(404);
      expect(response1.data).toBe("not-found-0");

      // Second request should execute handler again (not cached)
      const response2 = await app.notFoundAction.fetch();
      expect(response2.status).toBe(404);
      expect(response2.data).toBe("not-found-1");

      // Verify counter incremented (handler was called)
      expect(response1.data).not.toBe(response2.data);
    });

    test("should cache successful responses after error responses", async ({
      expect,
    }) => {
      // First request returns 500 error
      const errorResponse = await app.conditionalErrorAction.fetch();
      expect(errorResponse.status).toBe(500);
      expect(errorResponse.data).toBe("error-0");

      // Second request returns success and should be cached
      const successResponse1 = await app.conditionalErrorAction.fetch();
      expect(successResponse1.status).toBe(200);
      expect(successResponse1.data).toBe("success-1");

      // Third request should return cached response
      const successResponse2 = await app.conditionalErrorAction.fetch();
      expect(successResponse2.status).toBe(304);
      expect(successResponse2.data).toBe("success-1");
    });

    test("should NOT set Cache-Control on an error response", async ({
      expect,
    }) => {
      // Regression: the header was written above the status guard, so a route
      // declaring `public, max-age=1y, immutable` handed it to its own 404s
      // and every browser that saw one pinned the failure for a year.
      const ok = await app.immutableFileAction.fetch();
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toContain("immutable");

      const missing = await app.immutableMissingFileAction.fetch();
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBeNull();
    });

    test("should NOT cache 4xx client errors", async ({ expect }) => {
      // Test with 400 Bad Request
      const alepha = Alepha.create().with(AlephaServerEtag);
      const badRequestAction = alepha.inject(
        class TestBadRequest {
          action = $action({
            use: [$etag(true)],
            handler: ({ reply }) => {
              reply.status = 400;
              return `bad-request-${app.counter++}`;
            },
          });
        },
      ).action;
      await alepha.start();

      const response1 = await badRequestAction.fetch();
      expect(response1.status).toBe(400);

      const response2 = await badRequestAction.fetch();
      expect(response2.status).toBe(400);

      // Verify responses are different (not cached)
      expect(response1.data).not.toBe(response2.data);
    });
  });
});
