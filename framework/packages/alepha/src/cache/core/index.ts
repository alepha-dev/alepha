import { $module } from "alepha";
import { RedisActivation } from "alepha/redis";

import { $cache } from "./primitives/$cache.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";
import { RedisCacheProvider } from "./providers/RedisCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cache.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/CloudflareCacheProvider.ts";
export * from "./providers/CloudflareKVProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";
export * from "./providers/RedisCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Fires when a cache lookup finds a value.
     */
    "cache:hit": {
      container: string;
      key: string;
    };
    /**
     * Fires when a cache lookup does not find a value.
     */
    "cache:missed": {
      container: string;
      key: string;
    };
    /**
     * Fires when a value is written to the cache.
     */
    "cache:set": {
      container: string;
      key: string;
      ttlMs?: number;
    };
    /**
     * Fires when a stale value (SWR grace window) is served and a
     * background refresh is scheduled.
     */
    "cache:staleServed": {
      container: string;
      key: string;
    };
    /**
     * Fires when a background SWR refresh completes successfully and
     * the value has been written back to the cache.
     */
    "cache:revalidated": {
      container: string;
      key: string;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Type-safe caching with TTL support.
 *
 * **Features:**
 * - Cached computations with type-safe keys and values
 * - Configurable TTL
 * - Cache invalidation
 * - Automatic cache population
 * - Providers: Redis when `REDIS_URL` is set, Memory otherwise (Node, Bun),
 *   Cloudflare (workerd), Database (per `$cache`)
 *
 * Set `REDIS_URL` and every instance shares one cache; leave it unset and the
 * cache is this process's memory. An app's own `CacheProvider` substitution
 * wins over both.
 *
 * @module alepha.cache
 */
export const AlephaCache = $module({
  name: "alepha.cache",
  primitives: [$cache],
  services: [CacheProvider],
  variants: [MemoryCacheProvider, RedisCacheProvider],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: CacheProvider,
      use: alepha.inject(RedisActivation).isActive()
        ? RedisCacheProvider
        : MemoryCacheProvider,
    }),
});
