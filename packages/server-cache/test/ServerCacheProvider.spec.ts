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

			app.cachedAction.invalidate();

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
});
