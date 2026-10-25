import { $module } from "alepha";

import { $cache } from "./primitives/$cache.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cache.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/CloudflareCacheProvider.ts";
export * from "./providers/CloudflareKVProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The browser and react-native half of `alepha.cache`: memory only.
 *
 * ⚠️ It never imports `RedisCacheProvider`, which would pull `alepha/redis`
 * into every client bundle (`$page` imports `$cache`). Keep its exports in
 * step with `index.ts` by hand, minus the Redis provider.
 */
export const AlephaCache = $module({
  name: "alepha.cache",
  primitives: [$cache],
  services: [CacheProvider],
  variants: [MemoryCacheProvider],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: CacheProvider,
      use: MemoryCacheProvider,
    }),
});
