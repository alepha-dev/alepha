import { AlephaCache, CacheProvider } from "@alepha/cache";
import type { Alepha, Module } from "@alepha/core";
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
export class AlephaCacheRedis implements Module {
	public readonly name = "alepha.cache.redis";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha
			.with({
				provide: CacheProvider,
				use: RedisCacheProvider,
				optional: true,
			})
			.with(AlephaCache);
}
