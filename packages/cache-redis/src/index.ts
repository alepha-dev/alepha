import { AlephaCache, CacheProvider } from "@alepha/cache";
import { $module, type ModuleDescriptor } from "@alepha/core";
import { RedisCacheProvider } from "./providers/RedisCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Cache that provides Redis caching capabilities.
 *
 * @see {@link RedisCacheProvider}
 * @module alepha.cache.redis
 */
const AlephaCacheRedis: ModuleDescriptor = $module({
	name: "alepha.cache.redis",
	services: [RedisCacheProvider],
	register: (alepha) =>
		alepha
			.with({
				provide: CacheProvider,
				use: RedisCacheProvider,
				optional: true,
			})
			.with(AlephaCache),
});

export default AlephaCacheRedis;
