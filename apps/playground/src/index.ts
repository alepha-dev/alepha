import { CacheProvider } from "@alepha/cache";
import { AlephaCacheRedis } from "@alepha/cache-redis";
import { $hook, $inject, $logger, type Alepha, run } from "@alepha/core";

class App {
	log = $logger();
	cache = $inject(CacheProvider);

	ready = $hook({
		on: "ready",
		handler: async () => {
			this.log.info("App is ready!");
			this.log.info("Cache value:", await this.cache.get("z", "test"));
		},
	});
}

const $module = (args: any) => {};

const playground = $module({
	name: "alepha.playground",
	descriptors: [],
	services: [AlephaCacheRedis, App],
});

class PlaygroundModule {
	name = "playground";
	$services = (alepha: Alepha) => alepha.with(AlephaCacheRedis).with(App);
}

run(PlaygroundModule, {
	env: {
		LOG_LEVEL: "trace",
	},
});
