import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $action, $middleware, $route, ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { $etag, AlephaServerEtag, ServerEtagProvider } from "../index.ts";

/**
 * The shape of an HTTP-date (RFC 9110 section 5.6.7), the only form
 * `Last-Modified` may take.
 */
const HTTP_DATE =
  /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

const ETAG = /^"[a-f0-9]{32}"$/;

class TestEtagProvider extends ServerEtagProvider {
  public testCollectStreamForCache = this.collectStreamForCache.bind(this);
  public testStored = (key: string) => this.cache.get(key);
  public testCreateCacheKey = this.createCacheKey.bind(this);
}

/**
 * A stored route that answers a stream, the shape of an SSR page.
 */
class StreamApp {
  stored = $middleware({ path: "/streamed", use: [$etag(true)] });

  page = $route({
    method: "GET",
    path: "/streamed/page",
    handler: ({ reply }) => {
      reply.headers["content-type"] = "text/html";
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("<html>"));
          controller.enqueue(encoder.encode("streamed</html>"));
          controller.close();
        },
      });
    },
  });
}

class RestartApp {
  static calls = 0;

  action = $action({
    path: "/restartAction",
    method: "GET",
    use: [$etag(true)],
    handler: () => `restart-${RestartApp.calls++}`,
  });
}

class TestApp {
  counter = 0;
  protected resetCounter = 0;

  cachedAction = $action({
    path: "/cachedAction",
    method: "GET",
    use: [$etag(true)],
    handler: () => `cached-${this.counter++}`,
  });

  uncachedAction = $action({
    path: "/uncachedAction",
    method: "GET",
    handler: () => `uncached-${this.counter++}`,
  });

  cachedWithCustomTtl = $action({
    path: "/cachedWithCustomTtl",
    method: "GET",
    use: [$etag({ store: { ttl: 1000 } })],
    handler: () => `ttl-cached-${this.counter++}`,
  });

  cachedWithShortTtl = $action({
    path: "/cachedWithShortTtl",
    method: "GET",
    use: [$etag({ store: { ttl: [100, "milliseconds"] } })],
    handler: () => `short-ttl-${this.counter++}`,
  });

  cachedWithShortDurationStore = $action({
    path: "/cachedWithShortDurationStore",
    method: "GET",
    use: [$etag({ store: [100, "milliseconds"] })],
    handler: () => `short-store-${this.counter++}`,
  });

  asyncCachedAction = $action({
    path: "/asyncCachedAction",
    method: "GET",
    use: [$etag(true)],
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `async-cached-${this.counter++}`;
    },
  });

  etagOnlyAction = $action({
    path: "/etagOnlyAction",
    method: "GET",
    use: [$etag()],
    handler: () => `etag-only-${this.counter++}`,
  });

  etagAndCacheAction = $action({
    path: "/etagAndCacheAction",
    method: "GET",
    use: [$etag(true)],
    handler: () => `etag-and-cache-${this.counter++}`,
  });

  cacheWithControlTrue = $action({
    path: "/cacheWithControlTrue",
    method: "GET",
    use: [$etag({ store: true, control: true })],
    handler: () => `control-true-${this.counter++}`,
  });

  cacheWithControlString = $action({
    path: "/cacheWithControlString",
    method: "GET",
    use: [$etag({ store: true, control: "public, max-age=600, immutable" })],
    handler: () => `control-string-${this.counter++}`,
  });

  cacheWithControlObject = $action({
    path: "/cacheWithControlObject",
    method: "GET",
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
    path: "/cacheWithComplexControl",
    method: "GET",
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
    path: "/cacheWithDurationMaxAge",
    method: "GET",
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

  cacheWithStaleWhileRevalidate = $action({
    path: "/cacheWithStaleWhileRevalidate",
    method: "GET",
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
    path: "/cacheWithStaleWhileRevalidateDuration",
    method: "GET",
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
    path: "/errorAction",
    method: "GET",
    use: [$etag(true)],
    handler: ({ reply }) => {
      reply.status = 500;
      return `error-${this.counter++}`;
    },
  });

  notFoundAction = $action({
    path: "/notFoundAction",
    method: "GET",
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
    path: "/immutableFileAction",
    method: "GET",
    use: [
      $etag({
        control: { public: true, maxAge: [1, "year"], immutable: true },
      }),
    ],
    handler: () => "file-bytes",
  });

  immutableMissingFileAction = $action({
    path: "/immutableMissingFileAction",
    method: "GET",
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
    path: "/conditionalErrorAction",
    method: "GET",
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

  /**
   * Stored actions whose body echoes the request, so a store key shared by
   * two different requests shows up as the wrong body.
   */
  search = $action({
    path: "/search",
    method: "GET",
    use: [$etag(true)],
    schema: { query: z.object({ q: z.text() }) },
    handler: ({ query }) => `result-for[${query.q}]`,
  });

  pair = $action({
    path: "/pair",
    method: "GET",
    use: [$etag(true)],
    schema: { query: z.object({ a: z.text(), b: z.text().optional() }) },
    handler: ({ query }) => `a=[${query.a}] b=[${query.b}]`,
  });

  item = $action({
    path: "/item/:id",
    method: "GET",
    use: [$etag(true)],
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ x: z.text().optional() }),
    },
    handler: ({ params, query }) => `id=[${params.id}] x=[${query.x}]`,
  });

  counted = $action({
    path: "/counted/:id",
    method: "GET",
    use: [$etag(true)],
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ n: z.integer().optional() }),
    },
    handler: ({ params, query }) => `${params.id}-${query.n}-${this.counter++}`,
  });

  /**
   * One constant body per mode: the validator never changes, so a
   * conditional request can be answered 304.
   */
  stableEtagOnly = $action({
    path: "/stableEtagOnly",
    method: "GET",
    use: [$etag()],
    handler: () => "stable-bytes",
  });

  stableStored = $action({
    path: "/stableStored",
    method: "GET",
    use: [$etag(true)],
    handler: () => "stored-bytes",
  });

  /**
   * Two independently cached actions plus a plain HTTP action that invokes
   * both through `run()`. This is the `/api/_batch` and SSR `follow()`
   * shape: the inner actions declare `$etag`, the outer route does not.
   */
  nestedCounterA = 0;
  nestedCounterB = 0;

  nestedInnerA = $action({
    method: "GET",
    path: "/nested-inner-a",
    use: [$etag({ store: true, control: { public: true, maxAge: 600 } })],
    handler: () => `A-${this.nestedCounterA++}`,
  });

  nestedInnerB = $action({
    method: "GET",
    path: "/nested-inner-b",
    use: [$etag(true)],
    handler: () => `B-${this.nestedCounterB++}`,
  });

  nestedOuter = $action({
    method: "GET",
    path: "/nested-outer",
    handler: async () => {
      const a = await this.nestedInnerA.run();
      const b = await this.nestedInnerB.run();
      return `${a}|${b}`;
    },
  });

  reset() {
    this.counter = this.resetCounter++;
  }
}

describe("ServerEtagProvider", () => {
  let alepha: Alepha;
  let app: TestApp;
  let etagProvider: TestEtagProvider;

  /**
   * A raw request: `action.fetch()` goes through `HttpClient`, which keeps
   * its own ETag cache and adds `If-None-Match` by itself.
   */
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const hostname = alepha.inject(ServerProvider).hostname;
    const response = await fetch(`${hostname}/api${path}`, { headers });
    return {
      status: response.status,
      body: await response.text(),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  };

  beforeEach(async () => {
    alepha = Alepha.create()
      .with({ provide: ServerEtagProvider, use: TestEtagProvider })
      .with(AlephaServerEtag);
    app = alepha.inject(TestApp);
    etagProvider = alepha.inject(TestEtagProvider);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha?.stop();
  });

  it("uses SHA-256 truncated to 32 hex characters", async ({ expect }) => {
    expect(await etagProvider.generateETag("abc")).toBe(
      '"ba7816bf8f01cfea414140de5dae2223"',
    );
  });

  describe("ETag support", () => {
    it("should return 200 on first request and 304 on subsequent requests with same ETag", async ({
      expect,
    }) => {
      const firstResponse = await app.cachedAction.fetch();
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.data).toBe("cached-0");

      const secondResponse = await app.cachedAction.fetch();
      expect(secondResponse.status).toBe(304);
      expect(secondResponse.data).toBe("cached-0");
    });

    it("should return fresh data after cache invalidation", async ({
      expect,
    }) => {
      const firstResponse = await app.cachedAction.fetch();
      expect(firstResponse.data).toBe("cached-0");

      await etagProvider.invalidate(app.cachedAction.route);

      const afterInvalidation = await app.cachedAction.fetch();
      expect(afterInvalidation.status).toBe(200);
      expect(afterInvalidation.data).toBe("cached-1");
    });
  });

  describe("Cache behavior", () => {
    it("should cache responses for actions with $etag(true)", async ({
      expect,
    }) => {
      for (let i = 0; i < 5; i++) {
        const response1 = await app.cachedAction.fetch();
        const response2 = await app.cachedAction.fetch();
        expect(response1.data).toBe(response2.data);
        app.reset();
      }
    });

    it("should not cache responses for actions without $etag", async ({
      expect,
    }) => {
      for (let i = 0; i < 5; i++) {
        const response1 = await app.uncachedAction.fetch();
        const response2 = await app.uncachedAction.fetch();
        expect(response1.data).not.toBe(response2.data);
      }
    });

    it("should handle async cached actions correctly", async ({ expect }) => {
      const response1 = await app.asyncCachedAction.fetch();
      const response2 = await app.asyncCachedAction.fetch();

      expect(response1.data).toBe("async-cached-0");
      expect(response2.data).toBe("async-cached-0");
      expect(response1.data).toBe(response2.data);
    });
  });

  describe("Cache invalidation", () => {
    it("should invalidate every caller's entry for the route", async ({
      expect,
    }) => {
      // Entries are namespaced by caller identity, so invalidating a route
      // must clear all of them, not only the anonymous one.
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

    it("should invalidate cache using ServerEtagProvider.invalidate()", async ({
      expect,
    }) => {
      const initialResponse = await app.cachedAction.fetch();
      const cachedResponse = await app.cachedAction.fetch();

      expect(initialResponse.data).toBe(cachedResponse.data);

      await etagProvider.invalidate(app.cachedAction.route);

      const afterInvalidation = await app.cachedAction.fetch();
      expect(afterInvalidation.data).not.toBe(initialResponse.data);
    });

    it("should not affect other cached actions when invalidating specific route", async ({
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
    it("should respect custom TTL configuration", async ({ expect }) => {
      const response1 = await app.cachedWithCustomTtl.fetch();
      const response2 = await app.cachedWithCustomTtl.fetch();

      expect(response1.data).toBe(response2.data);
      expect(response1.data).toBe("ttl-cached-0");
    });

    it("should expire the stored response once store.ttl elapses", async ({
      expect,
    }) => {
      // The configured TTL was truth-tested but never passed to cache.set,
      // so every $etag store silently used the global cache default (300s).
      const first = await app.cachedWithShortTtl.fetch();
      const cached = await app.cachedWithShortTtl.fetch();
      expect(cached.data).toBe(first.data);

      await alepha.inject(DateTimeProvider).travel([250, "milliseconds"]);

      const afterExpiry = await app.cachedWithShortTtl.fetch();
      expect(afterExpiry.data).not.toBe(first.data);
    });

    it("should not serve one caller's stored body to another", async ({
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

    it("should accept a bare duration as store", async ({ expect }) => {
      const first = await app.cachedWithShortDurationStore.fetch();
      expect((await app.cachedWithShortDurationStore.fetch()).data).toBe(
        first.data,
      );

      await alepha.inject(DateTimeProvider).travel([250, "milliseconds"]);

      expect((await app.cachedWithShortDurationStore.fetch()).data).not.toBe(
        first.data,
      );
    });
  });

  describe("Error handling", () => {
    it("should handle invalidation of non-existent route gracefully", async ({
      expect,
    }) => {
      await expect(
        etagProvider.invalidate({
          method: "GET",
          path: "/no-such-route",
        } as any),
      ).resolves.toBeUndefined();

      // And it took nothing else with it.
      const first = await app.cachedAction.fetch();
      await etagProvider.invalidate({
        method: "GET",
        path: "/no-such-route",
      } as any);
      expect((await app.cachedAction.fetch()).data).toBe(first.data);
    });

    it("should handle cache invalidation during concurrent requests", async ({
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
    it("should maintain cache state across multiple requests", async ({
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

    it("should not carry a stored response over to a new container", async ({
      expect,
    }) => {
      // The handler's counter is static, so it outlives the container: a
      // store that survived the restart would answer `restart-0` again.
      RestartApp.calls = 0;

      const before = Alepha.create().with(AlephaServerEtag);
      const first = before.inject(RestartApp);
      await before.start();
      expect((await first.action.fetch()).data).toBe("restart-0");
      expect((await first.action.fetch()).data).toBe("restart-0");
      await before.stop();

      const after = Alepha.create().with(AlephaServerEtag);
      const second = after.inject(RestartApp);
      await after.start();
      expect((await second.action.fetch()).data).toBe("restart-1");
      await after.stop();
    });
  });

  describe("ETag-only support (without cache)", () => {
    it("should generate and return ETag header for etag-only routes", async ({
      expect,
    }) => {
      const response = await app.etagOnlyAction.fetch();

      expect(response.status).toBe(200);
      expect(response.data).toBe("etag-only-0");
      expect(response.headers.get("etag")).toMatch(ETAG);
    });

    it("should answer 304 with no body when the body is unchanged", async ({
      expect,
    }) => {
      const first = await get("/stableEtagOnly");
      expect(first.status).toBe(200);
      expect(first.body).toBe("stable-bytes");
      expect(first.etag).toMatch(ETAG);

      const second = await get("/stableEtagOnly", {
        "if-none-match": first.etag!,
      });
      expect(second.status).toBe(304);
      expect(second.body).toBe("");
      expect(second.etag).toBe(first.etag);
    });

    it("should NOT cache responses for etag-only routes", async ({
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

    it("should return 200 with new content when ETag doesn't match", async ({
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
  });

  describe("ETag with cache combined", () => {
    it("should return cached content even without ETag header", async ({
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

    it("should invalidate both cache and ETag when cache is cleared", async ({
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
      expect(etag1).toMatch(ETAG);
      expect(etag2).toMatch(ETAG);
      expect(etag1).not.toBe(etag2);
    });
  });

  describe("ETag header validation", () => {
    it("should generate consistent ETags for same content", async ({
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

    it("should generate different ETags for different content", async ({
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
  });

  describe("Store key", () => {
    it("keeps a value holding a colon apart from the same value without it", async ({
      expect,
    }) => {
      expect((await get("/search?q=a%3Ab")).body).toBe("result-for[a:b]");
      expect((await get("/search?q=ab")).body).toBe("result-for[ab]");
    });

    it("keeps one value holding `,b=2` apart from two parameters", async ({
      expect,
    }) => {
      expect((await get("/pair?a=1%2Cb%3D2")).body).toBe(
        "a=[1,b=2] b=[undefined]",
      );
      expect((await get("/pair?a=1&b=2")).body).toBe("a=[1] b=[2]");
    });

    it("keeps a path parameter apart from a query parameter", async ({
      expect,
    }) => {
      expect((await get("/item/1%2Cx%3D2")).body).toBe(
        "id=[1,x=2] x=[undefined]",
      );
      expect((await get("/item/1?x=2")).body).toBe("id=[1] x=[2]");
    });

    for (const separator of [
      ":",
      ",",
      "=",
      "&",
      "%",
      "*",
      '"',
      "[",
      "{",
      "/",
    ]) {
      // A guard for every separator but `:` and `,`, the two the old key
      // was built with: the others already passed before the key changed.
      it(`a value holding \`${separator}\` never answers for another request`, async ({
        expect,
      }) => {
        const sep = encodeURIComponent(separator);

        // Planted first: one value that spells out a second parameter.
        expect((await get(`/pair?a=1${sep}b${sep}2`)).body).toBe(
          `a=[1${separator}b${separator}2] b=[undefined]`,
        );
        expect((await get(`/pair?a=1${sep}b%3D2`)).body).toBe(
          `a=[1${separator}b=2] b=[undefined]`,
        );
        expect((await get(`/pair?a=1&b=2`)).body).toBe("a=[1] b=[2]");
        expect((await get(`/pair?a=1b2`)).body).toBe("a=[1b2] b=[undefined]");
        expect((await get(`/pair?a=1b&b=2`)).body).toBe("a=[1b] b=[2]");

        // And each of them is still served from its own entry.
        expect((await get(`/pair?a=1${sep}b${sep}2`)).body).toBe(
          `a=[1${separator}b${separator}2] b=[undefined]`,
        );
      });
    }

    it("keeps a bigint apart from the string that spells it", async ({
      expect,
    }) => {
      const route = { method: "GET", path: "/big" } as any;
      const key = (query: Record<string, unknown>) =>
        etagProvider.testCreateCacheKey(route, { query } as any);

      expect(await key({ n: 5n })).not.toBe(await key({ n: "5n" }));
      expect(await key({ n: 5n })).not.toBe(await key({ n: "5" }));
      expect(await key({ n: 5n })).not.toBe(await key({ n: 5 }));
      expect(await key({ n: 5n })).not.toBe(await key({ n: "n:5" }));
      expect(await key({ n: "s:5" })).not.toBe(await key({ n: "5" }));
      expect(await key({ n: 5n })).toBe(await key({ n: 5n }));
    });

    it("guard: serves a hit for a typed query, over HTTP and through run()", async ({
      expect,
    }) => {
      const first = await get("/counted/1?n=7");
      expect(first.body).toMatch(/^1-7-\d+$/);
      expect((await get("/counted/1?n=7")).body).toBe(first.body);
      // The key is built from the parsed query: `07` is the integer 7.
      expect((await get("/counted/1?n=07")).body).toBe(first.body);
      expect((await get("/counted/1?n=8")).body).not.toBe(first.body);

      const ran = await app.counted.run({
        params: { id: "2" },
        query: { n: 7 },
      });
      expect(
        await app.counted.run({ params: { id: "2" }, query: { n: 7 } }),
      ).toBe(ran);
      expect(
        await app.counted.run({ params: { id: "2" }, query: { n: 8 } }),
      ).not.toBe(ran);
    });

    it("guard: invalidates every entry of a route, whatever its parameters", async ({
      expect,
    }) => {
      const one = await get("/counted/1?n=7");
      const two = await get("/counted/a%3Ab");
      const kept = await get("/cachedAction");

      await etagProvider.invalidate(app.counted.route);

      expect((await get("/counted/1?n=7")).body).not.toBe(one.body);
      expect((await get("/counted/a%3Ab")).body).not.toBe(two.body);
      expect((await get("/cachedAction")).body).toBe(kept.body);
    });
  });

  describe("If-None-Match (RFC 9110 section 13.1.2)", () => {
    for (const path of ["/stableEtagOnly", "/stableStored"]) {
      describe(`on ${path}`, () => {
        it("matches a weak validator", async ({ expect }) => {
          const { etag } = await get(path);
          expect(etag).toMatch(ETAG);

          const response = await get(path, { "if-none-match": `W/${etag}` });
          expect(response.status).toBe(304);
          expect(response.body).toBe("");
        });

        it("matches any member of a list", async ({ expect }) => {
          const { etag } = await get(path);

          const response = await get(path, {
            "if-none-match": `"other", W/"a,b" ,${etag}`,
          });
          expect(response.status).toBe(304);
        });

        it("matches `*`", async ({ expect }) => {
          await get(path);

          const response = await get(path, { "if-none-match": "*" });
          expect(response.status).toBe(304);
        });

        it("guard: answers the body when no validator matches", async ({
          expect,
        }) => {
          const { etag, body } = await get(path);

          for (const header of [
            '"other"',
            'W/"other"',
            '"other", "another"',
            // The opaque tag is compared whole, never as a substring.
            `"x${etag!.slice(1)}`,
            etag!.slice(1, -1),
          ]) {
            const response = await get(path, { "if-none-match": header });
            expect(response.status, header).toBe(200);
            expect(response.body, header).toBe(body);
          }
        });
      });
    }
  });

  describe("matchesIfNoneMatch", () => {
    it("reads the header as a list of entity-tags", ({ expect }) => {
      const matches = (header: string) =>
        etagProvider.matchesIfNoneMatch(header, '"abc"');

      for (const header of [
        '"abc"',
        'W/"abc"',
        '"a,b", "abc"',
        '"x",W/"abc"',
        ' "x" , "abc" ',
        "*",
        " * ",
      ]) {
        expect(matches(header), header).toBe(true);
      }

      for (const header of [
        '"a,abc"',
        '"ABC"',
        // Malformed: such a header matches nothing.
        'x"abc"',
        '"" "abc"',
        'w/"abc"',
        '"abc',
        "abc",
        '"x", *',
        '*, "abc"',
        '"abc",',
        "",
      ]) {
        expect(matches(header), header).toBe(false);
      }

      expect(etagProvider.matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true);
      expect(etagProvider.matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
    });
  });

  describe("Last-Modified", () => {
    it("is an HTTP-date, and stays the stored time on every hit", async ({
      expect,
    }) => {
      const first = await get("/stableStored");
      expect(first.lastModified).toMatch(HTTP_DATE);

      await alepha.inject(DateTimeProvider).travel([5, "seconds"]);

      const second = await get("/stableStored");
      expect(second.body).toBe("stored-bytes");
      expect(second.lastModified).toBe(first.lastModified);
    });

    it("is not sent by a route that stores nothing", async ({ expect }) => {
      // There is no stored time to report, and "now" on every response
      // tells a cache the resource keeps changing.
      const response = await get("/stableEtagOnly");
      expect(response.etag).toMatch(ETAG);
      expect(response.lastModified).toBeNull();
    });

    it("answers 304 to an If-Modified-Since at or after the stored time", async ({
      expect,
    }) => {
      const first = await get("/stableStored");
      const stored = new Date(first.lastModified!).getTime();

      for (const [since, status] of [
        [first.lastModified!, 304],
        [new Date(stored + 60_000).toUTCString(), 304],
        [new Date(stored - 60_000).toUTCString(), 200],
        // Not an HTTP-date: ignored, whatever `Date.parse` makes of it.
        ["not a date", 200],
        ["2099", 200],
        [new Date(stored + 60_000).toISOString(), 200],
      ] as const) {
        const response = await get("/stableStored", {
          "if-modified-since": since,
        });
        expect(response.status, since).toBe(status);
      }
    });

    it("is the stored time, as an HTTP-date, on a stored stream too", async ({
      expect,
    }) => {
      const streaming = Alepha.create().with(AlephaServerEtag);
      streaming.inject(StreamApp);
      await streaming.start();
      const url = `${streaming.inject(ServerProvider).hostname}/streamed/page`;

      const first = await fetch(url);
      expect(await first.text()).toBe("<html>streamed</html>");

      // The stream is collected into the store behind the response.
      let hit = await fetch(url);
      for (let i = 0; i < 50 && !hit.headers.get("etag"); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        hit = await fetch(url);
      }

      expect(await hit.text()).toBe("<html>streamed</html>");
      expect(hit.headers.get("etag")).toMatch(ETAG);
      expect(hit.headers.get("last-modified")).toMatch(HTTP_DATE);

      await streaming.stop();
    });

    it("ignores If-Modified-Since when If-None-Match is sent", async ({
      expect,
    }) => {
      const first = await get("/stableStored");

      const response = await get("/stableStored", {
        "if-none-match": '"other"',
        "if-modified-since": first.lastModified!,
      });
      expect(response.status).toBe(200);
      expect(response.body).toBe("stored-bytes");
    });
  });

  describe("Mixed scenarios", () => {
    it("should handle routes with different etag configurations independently", async ({
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

    it("should not interfere with each other's ETags", async ({ expect }) => {
      const response1 = await app.etagOnlyAction.fetch();
      const etag1 = response1.headers.get("etag");

      const response2 = await app.cachedAction.fetch();
      const etag2 = response2.headers.get("etag");

      // Different actions should have different ETags
      expect(etag1).not.toBe(etag2);
    });
  });

  describe("Cache-Control header support", () => {
    it("should set Cache-Control header when control: true", async ({
      expect,
    }) => {
      const response = await app.cacheWithControlTrue.fetch();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    });

    it("should set Cache-Control header with custom string value", async ({
      expect,
    }) => {
      const response = await app.cacheWithControlString.fetch();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=600, immutable",
      );
    });

    it("should build Cache-Control header from object directives", async ({
      expect,
    }) => {
      const response = await app.cacheWithControlObject.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("max-age=3600");
      expect(cacheControl).toContain("must-revalidate");
    });

    it("should support complex Cache-Control with multiple directives", async ({
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

    it("should not set Cache-Control when $etag(true) without control option", async ({
      expect,
    }) => {
      const response = await app.cachedAction.fetch();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBeNull();
    });

    it("should cache responses with Cache-Control headers", async ({
      expect,
    }) => {
      const response1 = await app.cacheWithControlObject.fetch();
      const response2 = await app.cacheWithControlObject.fetch();

      expect(response1.data).toBe(response2.data);
      expect(response1.data).toBe("control-object-0");
    });

    it("should support private cache directive", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const privateAction = alepha.inject(
        class TestPrivateCache {
          action = $action({
            path: "/action",
            method: "GET",
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

    it("should support no-cache and no-store directives", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const noCacheAction = alepha.inject(
        class TestNoCache {
          action = $action({
            path: "/action",
            method: "GET",
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

    it("should support proxy-revalidate directive", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const proxyAction = alepha.inject(
        class TestProxyRevalidate {
          action = $action({
            path: "/action",
            method: "GET",
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

    it("should support s-maxage for shared cache control", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaServerEtag);
      const sharedCacheAction = alepha.inject(
        class TestSharedCache {
          action = $action({
            path: "/action",
            method: "GET",
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

    it("should support DurationLike for maxAge and sMaxAge", async ({
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

    it("should handle various DurationLike formats for maxAge", ({
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

    it("should mix number and DurationLike for maxAge and sMaxAge", ({
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

    it("should support stale-while-revalidate directive with number", async ({
      expect,
    }) => {
      const response = await app.cacheWithStaleWhileRevalidate.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("s-maxage=900");
      expect(cacheControl).toContain("stale-while-revalidate=60");
    });

    it("should support stale-while-revalidate directive with DurationLike", async ({
      expect,
    }) => {
      const response = await app.cacheWithStaleWhileRevalidateDuration.fetch();

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("s-maxage=900");
      expect(cacheControl).toContain("stale-while-revalidate=60");
    });

    it("should handle stale-while-revalidate via buildCacheControlHeader", ({
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
    it("should cache ReadableStream responses via tee", async ({ expect }) => {
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

      const key = "test-stream-key";

      // Collect the stream for cache
      const hash = await etagProvider.testCollectStreamForCache(
        stream,
        key,
        200,
        "text/html",
        true,
      );

      expect(hash).toMatch(ETAG);

      // Verify the cache contains the collected content
      const cached = await etagProvider.testStored(key);
      expect(cached?.body).toBe("Hello World");
      expect(cached?.status).toBe(200);
      expect(cached?.contentType).toBe("text/html");
    });

    it("should handle empty stream gracefully", async ({ expect }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      const key = "empty-stream-key";

      const hash = await etagProvider.testCollectStreamForCache(
        stream,
        key,
        200,
        "text/html",
        true,
      );

      expect(hash).toBe(await etagProvider.generateETag(""));

      const cached = await etagProvider.testStored(key);
      expect(cached?.body).toBe("");
    });

    it("should handle large stream with multiple chunks", async ({
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

      const key = "large-stream-key";

      const hash = await etagProvider.testCollectStreamForCache(
        stream,
        key,
        200,
        "text/html",
        false,
      );

      // hash should be undefined when generateEtag is false
      expect(hash).toBeUndefined();

      const cached = await etagProvider.testStored(key);
      expect(cached?.body.length).toBe(chunkCount * chunkContent.length);
    });

    it("should generate correct ETag for streamed content", async ({
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

      // Generate ETag from stream
      const streamHash = await etagProvider.testCollectStreamForCache(
        stream,
        "etag-test-key",
        200,
        "text/html",
        true,
      );

      // Generate ETag from string directly
      const stringHash = await etagProvider.generateETag(content);

      // Both should produce the same ETag
      expect(streamHash).toBe(stringHash);
    });
  });

  describe("Error response caching", () => {
    it("should NOT cache 500 error responses", async ({ expect }) => {
      // An error status is thrown by the client; the body is its message.
      const error1 = await app.errorAction.fetch().catch((e) => e);
      expect(error1.status).toBe(500);
      expect(error1.message).toBe("error-0");

      // Second request should execute handler again (not cached)
      const error2 = await app.errorAction.fetch().catch((e) => e);
      expect(error2.status).toBe(500);
      expect(error2.message).toBe("error-1");
    });

    it("should NOT cache 404 error responses", async ({ expect }) => {
      const error1 = await app.notFoundAction.fetch().catch((e) => e);
      expect(error1.status).toBe(404);
      expect(error1.message).toBe("not-found-0");

      // Second request should execute handler again (not cached)
      const error2 = await app.notFoundAction.fetch().catch((e) => e);
      expect(error2.status).toBe(404);
      expect(error2.message).toBe("not-found-1");
    });

    it("should cache successful responses after error responses", async ({
      expect,
    }) => {
      // First request returns 500 error
      const error = await app.conditionalErrorAction.fetch().catch((e) => e);
      expect(error.status).toBe(500);
      expect(error.message).toBe("error-0");

      // Second request returns success and should be cached
      const successResponse1 = await app.conditionalErrorAction.fetch();
      expect(successResponse1.status).toBe(200);
      expect(successResponse1.data).toBe("success-1");

      // Third request should return cached response
      const successResponse2 = await app.conditionalErrorAction.fetch();
      expect(successResponse2.status).toBe(304);
      expect(successResponse2.data).toBe("success-1");
    });

    it("should NOT set Cache-Control on an error response", async ({
      expect,
    }) => {
      // Regression: the header was written above the status guard, so a route
      // declaring `public, max-age=1y, immutable` handed it to its own 404s
      // and every browser that saw one pinned the failure for a year.
      const ok = await app.immutableFileAction.fetch();
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toContain("immutable");

      // Raw fetch: the client throws on a 404 and an error carries no headers.
      const missing = await fetch(
        `${alepha.inject(ServerProvider).hostname}${app.immutableMissingFileAction.path}`,
      );
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBeNull();
    });

    it("should NOT cache 4xx client errors", async ({ expect }) => {
      // Test with 400 Bad Request
      const alepha = Alepha.create().with(AlephaServerEtag);
      const badRequestAction = alepha.inject(
        class TestBadRequest {
          action = $action({
            path: "/action",
            method: "GET",
            use: [$etag(true)],
            handler: ({ reply }) => {
              reply.status = 400;
              return `bad-request-${app.counter++}`;
            },
          });
        },
      ).action;
      await alepha.start();

      const error1 = await badRequestAction.fetch().catch((e) => e);
      expect(error1.status).toBe(400);

      const error2 = await badRequestAction.fetch().catch((e) => e);
      expect(error2.status).toBe(400);

      // Verify responses are different (not cached)
      expect(error1.message).not.toBe(error2.message);
    });
  });

  describe("Nested run() invocations", () => {
    it("caches each inner action under its own key, not the outer route's", async ({
      expect,
    }) => {
      const first = await app.nestedOuter.fetch();
      expect(first.status).toBe(200);
      expect(first.data).toBe("A-0|B-0");

      // Second call: both inner actions answer from THEIR OWN cache entries,
      // and the outer route - which declares no `$etag` - still answers 200
      // with a body it computed itself. Before the fix the middleware
      // resolved the container-wide `alepha.http.request`, so the outer body
      // was stored under the OUTER route's key, and on this second call the
      // first inner action found it, wrote a 304 onto the outer reply and
      // returned the page's own body as its result.
      const second = await app.nestedOuter.fetch();
      expect(second.status).toBe(200);
      expect(second.data).toBe("A-0|B-0");
      expect(app.nestedCounterA).toBe(1);
      expect(app.nestedCounterB).toBe(1);

      // And each inner action's entry is its own: invalidating one leaves
      // the other served from cache.
      await etagProvider.invalidate(app.nestedInnerA.route);
      expect(await app.nestedInnerA.run()).toBe("A-1");
      expect(await app.nestedInnerB.run()).toBe("B-0");
    });

    it("leaves the outer response headers untouched", async ({ expect }) => {
      const response = await app.nestedOuter.fetch();

      // `nestedOuter` declares no `$etag`, so nothing an inner action asked
      // for may reach the page's own response.
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBeNull();
      expect(response.headers.get("etag")).toBeNull();
    });
  });
});
