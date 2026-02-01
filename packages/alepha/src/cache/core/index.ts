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
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.9.0 | node, bun, workerd|
 *
 * Type-safe caching with TTL support.
 *
 * **Features:**
 * - Cached computations with type-safe keys and values
 * - Configurable TTL
 * - Cache invalidation
 * - Automatic cache population
 * - Providers: Memory (default), Redis
 *
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
