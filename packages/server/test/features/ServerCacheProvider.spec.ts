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
	for (let i = 0; i < 10; i++) {
		expect(await app.cache.fetch().then((r) => r.data)).toBe(
			await app.cache.fetch().then((r) => r.data),
		);
		expect(await app.noCache.fetch().then((r) => r.data)).not.toBe(
			await app.noCache.fetch().then((r) => r.data),
		);
	}
});

test("ServerCacheProvider - invalidate", async ({ expect }) => {
	const count = await app.cache.fetch().then((r) => r.data);

	expect(count).toBe(await app.cache.fetch().then((r) => r.data));

	const serverCacheProvider = alepha.get(ServerCacheProvider);
	await serverCacheProvider.invalidate(app.cache);

	expect(count).not.toBe(await app.cache.fetch().then((r) => r.data));
});
