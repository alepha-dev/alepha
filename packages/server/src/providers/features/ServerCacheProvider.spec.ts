import { CacheModule } from "@alepha/cache";
import { Alepha } from "@alepha/core";
import { describe, test } from "vitest";
import { $action } from "../../descriptors/$action.ts";
import { ServerModule } from "../../index.ts";
import { ServerCacheProvider } from "./ServerCacheProvider.ts";

class App {
	counter = 0;
	cache = $action({
		cache: [2, "minutes"],
		handler: () => `${this.counter++}`,
	});
}

describe("ServerCacheProvider", () => {
	const alepha = Alepha.create();

	alepha.with(ServerModule);
	alepha.with(CacheModule);
	alepha.with(ServerCacheProvider);

	const app = alepha.get(App);

	test("etag", async ({ expect }) => {
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
});
