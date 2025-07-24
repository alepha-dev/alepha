import { Alepha } from "@alepha/core";
import { $action } from "@alepha/server";
import { describe, test } from "vitest";
import { AlephaServerCache, ServerCacheProvider } from "../src";

class App {
	counter = 0;
	cache = $action({
		cache: true,
		handler: () => `${this.counter++}`,
	});
	noCache = $action({
		cache: false,
		handler: () => `${this.counter++}`,
	});
}

describe("ServerCacheProvider", () => {
	test("etag", async ({ expect }) => {
		const alepha = Alepha.create().with(AlephaServerCache);
		const app = alepha.inject(App);
		await alepha.start();

		{
			const { data, status } = await app.cache.fetch();
			expect(status).toBe(200);
			expect(data).toBe("0");
		}
		{
			const { data, status } = await app.cache.fetch();
			expect(status).toBe(304);
			expect(data).toBe("0");
		}
	});

	test("default", async ({ expect }) => {
		const alepha = Alepha.create().with(AlephaServerCache);
		const app = alepha.inject(App);
		await alepha.start();

		for (let i = 0; i < 10; i++) {
			expect(await app.cache.fetch().then((r) => r.data)).toBe(
				await app.cache.fetch().then((r) => r.data),
			);
			expect(await app.noCache.fetch().then((r) => r.data)).not.toBe(
				await app.noCache.fetch().then((r) => r.data),
			);
		}
	});

	test("invalidate", async ({ expect }) => {
		const alepha = Alepha.create().with(AlephaServerCache);
		const app = alepha.inject(App);
		await alepha.start();

		const count = await app.cache.fetch().then((r) => r.data);

		expect(count).toBe(await app.cache.fetch().then((r) => r.data));

		const serverCacheProvider = alepha.inject(ServerCacheProvider);
		await serverCacheProvider.invalidate(app.cache);

		expect(count).not.toBe(await app.cache.fetch().then((r) => r.data));
	});

	test("invalidate - $action", async ({ expect }) => {
		const alepha = Alepha.create().with(AlephaServerCache);
		const app = alepha.inject(App);
		await alepha.start();

		const count = await app.cache.fetch().then((r) => r.data);

		expect(count).toBe(await app.cache.fetch().then((r) => r.data));

		app.cache.invalidate();

		expect(count).not.toBe(await app.cache.fetch().then((r) => r.data));
	});
});
