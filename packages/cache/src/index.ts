import { __bind, type Alepha, type Module } from "@alepha/core";
import { $cache } from "./descriptors/$cache.ts";
import { CacheDescriptorProvider } from "./providers/CacheDescriptorProvider.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$cache.ts";
export * from "./providers/CacheDescriptorProvider.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides high-performance caching capabilities for Alepha applications with configurable TTL and multiple storage backends.
 *
 * The cache module enables declarative caching through the `$cache` descriptor, allowing you to cache method results,
 * API responses, or computed values with automatic invalidation and type safety. It supports both in-memory and
 * persistent storage backends for different performance and durability requirements.
 *
 * @see {@link $cache}
 * @see {@link CacheProvider}
 * @module alepha.cache
 */
export class AlephaCache implements Module {
	public readonly name = "alepha.cache";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha
			.with({
				provide: CacheProvider,
				use: MemoryCacheProvider,
				optional: true,
			})
			.with(CacheDescriptorProvider);
}

__bind($cache, AlephaCache);
__bind(CacheProvider, AlephaCache);
