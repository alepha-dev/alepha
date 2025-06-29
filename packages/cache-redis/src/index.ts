import { AlephaCache, CacheProvider } from "@alepha/cache";
import type { Alepha, Module } from "@alepha/core";
import { RedisCacheProvider } from "./providers/RedisCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Cache Redis Module
 *
 * Plugin for Alepha Cache that provides Redis caching capabilities.
 *
 * @see {@link RedisCacheProvider}
 * @module alepha.cache.redis
 */
export class AlephaRedisCache implements Module {
	public readonly name = "alepha.cache.redis";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with({
				provide: CacheProvider,
				use: RedisCacheProvider,
				optional: true,
			})
			.with(AlephaCache);
}
