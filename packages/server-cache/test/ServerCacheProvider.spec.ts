import { Alepha } from "@alepha/core";
import { $action } from "@alepha/server";
import { afterEach, beforeEach, describe, test } from "vitest";
import { AlephaServerCache, ServerCacheProvider } from "../src";

class TestApp {
	counter = 0;
	private resetCounter = 0;

	cachedAction = $action({
		cache: true,
		handler: () => `cached-${this.counter++}`,
	});

	uncachedAction = $action({
		cache: false,
		handler: () => `uncached-${this.counter++}`,
	});

	cachedWithCustomTtl = $action({
		cache: { ttl: 1000 },
		handler: () => `ttl-cached-${this.counter++}`,
	});

	asyncCachedAction = $action({
		cache: true,
		handler: async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return `async-cached-${this.counter++}`;
		},
	});

	etagOnlyAction = $action({
		etag: true,
		handler: () => `etag-only-${this.counter++}`,
	});

	etagAndCacheAction = $action({
		etag: true,
		cache: true,
		handler: () => `etag-and-cache-${this.counter++}`,
	});

	dynamicContentAction = $action({
		etag: true,
		handler: () => `dynamic-${Date.now()}`,
	});

	errorAction = $action({
		cache: true,
		handler: ({ reply }) => {
			reply.status = 500;
			return `error-${this.counter++}`;
		},
	});

	notFoundAction = $action({
		cache: true,
		handler: ({ reply }) => {
			reply.status = 404;
			return `not-found-${this.counter++}`;
		},
	});

	conditionalErrorAction = $action({
		cache: true,
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

describe("ServerCacheProvider", () => {
	let alepha: Alepha;
	let app: TestApp;
	let cacheProvider: ServerCacheProvider;

	beforeEach(async () => {
		alepha = Alepha.create().with(AlephaServerCache);
		app = alepha.inject(TestApp);
		cacheProvider = alepha.inject(ServerCacheProvider);
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

			await cacheProvider.invalidate(app.cachedAction.route);

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
			await cacheProvider.invalidate(app.cachedAction.route);
			const afterInvalidation = await app.cachedAction.fetch();
			expect(afterInvalidation.status).toBe(200);
			expect(afterInvalidation.data).toBe("cached-1");
		});
	});

	describe("Cache behavior", () => {
		test("should cache responses for actions with cache: true", async ({
			expect,
		}) => {
			for (let i = 0; i < 5; i++) {
				const response1 = await app.cachedAction.fetch();
				const response2 = await app.cachedAction.fetch();
				expect(response1.data).toBe(response2.data);
				app.reset();
			}
		});

		test("should not cache responses for actions with cache: false", async ({
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
		test("should invalidate cache using ServerCacheProvider.invalidate()", async ({
			expect,
		}) => {
			const initialResponse = await app.cachedAction.fetch();
			const cachedResponse = await app.cachedAction.fetch();

			expect(initialResponse.data).toBe(cachedResponse.data);

			await cacheProvider.invalidate(app.cachedAction.route);

			const afterInvalidation = await app.cachedAction.fetch();
			expect(afterInvalidation.data).not.toBe(initialResponse.data);
		});

		test("should invalidate cache using action.invalidate() method", async ({
			expect,
		}) => {
			const initialResponse = await app.cachedAction.fetch();
			const cachedResponse = await app.cachedAction.fetch();

			expect(initialResponse.data).toBe(cachedResponse.data);

			await app.cachedAction.invalidate();

			const afterInvalidation = await app.cachedAction.fetch();
			expect(afterInvalidation.data).not.toBe(initialResponse.data);
		});

		test("should not affect other cached actions when invalidating specific route", async ({
			expect,
		}) => {
			const cachedResponse1 = await app.cachedAction.fetch();
			const ttlCachedResponse1 = await app.cachedWithCustomTtl.fetch();

			await cacheProvider.invalidate(app.cachedAction.route);

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
	});

	describe("Error handling", () => {
		test("should handle invalidation of non-existent route gracefully", async ({
			expect,
		}) => {
			expect(async () => {
				await cacheProvider.invalidate("non-existent-route" as any);
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

			await cacheProvider.invalidate(app.cachedAction.route);

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

			alepha = Alepha.create().with(AlephaServerCache);
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
			await cacheProvider.invalidate(app.etagAndCacheAction.route);

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
		test("should handle routes with different cache/etag configurations independently", async ({
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

		test("should NOT cache 4xx client errors", async ({ expect }) => {
			// Test with 400 Bad Request
			const alepha = Alepha.create();
			const badRequestAction = alepha.inject(
				class TestBadRequest {
					action = $action({
						cache: true,
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
