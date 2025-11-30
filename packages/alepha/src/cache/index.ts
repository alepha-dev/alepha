import { $module } from "alepha";
import { $cache } from "./primitives/$cache.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cache.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides high-performance caching capabilities for Alepha applications with configurable TTL and multiple storage backends.
 *
 * The cache module enables declarative caching through the `$cache` primitive, allowing you to cache method results,
 * API responses, or computed values with automatic invalidation and type safety. It supports both in-memory and
 * persistent storage backends for different performance and durability requirements.
 *
 * @see {@link $cache}
 * @see {@link CacheProvider}
 * @module alepha.cache
 */
export const AlephaCache = $module({
  name: "alepha.cache",
  primitives: [$cache],
  services: [CacheProvider, MemoryCacheProvider],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: CacheProvider,
      use: MemoryCacheProvider,
    }),
});
