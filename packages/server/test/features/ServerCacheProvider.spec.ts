import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { $action } from "../../src";
import { ServerCacheProvider } from "../../src/providers/features/ServerCacheProvider.ts";

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

const alepha = Alepha.create();
const app = alepha.get(App);

test("ServerCacheProvider - default", async ({ expect }) => {
	expect(await app.cache.fetch()).toBe(await app.cache.fetch());
	expect(await app.noCache.fetch()).not.toBe(await app.noCache.fetch());
	expect(await app.cache.fetch()).toBe(await app.cache.fetch());
	expect(await app.noCache.fetch()).not.toBe(await app.noCache.fetch());
	expect(await app.cache.fetch()).toBe(await app.cache.fetch());
});

test("ServerCacheProvider - invalidate", async ({ expect }) => {
	const count = await app.cache.fetch();

	expect(count).toBe(await app.cache.fetch());

	const serverCacheProvider = alepha.get(ServerCacheProvider);
	await serverCacheProvider.invalidate(app.cache);

	expect(count).not.toBe(await app.cache.fetch());
});
