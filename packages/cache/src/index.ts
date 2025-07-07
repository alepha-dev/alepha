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
 * Alepha Cache Module
 *
 * This module provides a caching mechanism for Alepha applications.
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
