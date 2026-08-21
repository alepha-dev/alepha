import { $module } from "alepha";
import { AlephaCache, CacheProvider } from "alepha/cache";

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
export const AlephaCacheRedis = $module({
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
