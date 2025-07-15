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
 * **Key Features:**
 * - Declarative caching with `$cache` descriptor on class properties
 * - Configurable TTL (time-to-live) with duration literals
 * - Custom key generation and automatic serialization
 * - Multiple storage backends (memory, Redis, etc.)
 * - Cache invalidation and manual cache operations
 * - Type-safe operations with full TypeScript support
 * 
 * **Basic Usage:**
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { AlephaCache, $cache } from "alepha/cache";
 * 
 * class UserService {
 *   getUserData = $cache({
 *     key: (userId: string) => `user:${userId}`,
 *     ttl: [1, "hour"],
 *     handler: async (userId: string) => {
 *       // This will be cached for 1 hour
 *       return await fetchUserFromDatabase(userId);
 *     },
 *   });
 * 
 *   getUserProfile = $cache({
 *     provider: "memory",
 *     ttl: [5, "minutes"],
 *     handler: async (userId: string) => {
 *       return await buildUserProfile(userId);
 *     },
 *   });
 * }
 * 
 * const alepha = Alepha.create()
 *   .with(AlephaCache)
 *   .with(UserService);
 * 
 * run(alepha);
 * ```
 * 
 * **Cache Operations:**
 * ```ts
 * class ProductService {
 *   productCache = $cache({
 *     handler: async (productId: string) => {
 *       return await getProduct(productId);
 *     },
 *   });
 * 
 *   async getProduct(id: string) {
 *     // Get from cache or compute
 *     return await this.productCache(id);
 *   }
 * 
 *   async updateProduct(id: string, data: any) {
 *     await updateProductInDb(id, data);
 *     // Invalidate cache
 *     await this.productCache.invalidate(this.productCache.key(id));
 *   }
 * 
 *   async warmUpCache(id: string, data: any) {
 *     // Manually set cache
 *     await this.productCache.set(this.productCache.key(id), data, [30, "minutes"]);
 *   }
 * }
 * ```
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
