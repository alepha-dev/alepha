import { $module } from "alepha";

import { $cache } from "./primitives/$cache.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { CloudflareCacheProvider } from "./providers/CloudflareCacheProvider.ts";
import { CloudflareKVProvider } from "./providers/CloudflareKVProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cache.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/CloudflareCacheProvider.ts";
export * from "./providers/CloudflareKVProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The workerd half of `alepha.cache`.
 *
 * ⚠️ **The default is {@link CloudflareCacheProvider}, not KV.** It picks the
 * database cache when the container has one and falls back to KV when it does
 * not; read that class for why the default moved and why the choice is made
 * at `start` rather than here.
 *
 * Binding KV directly is still one line - `provider: CloudflareKVProvider` on
 * a `$cache`, or a substitution - and an app with no database gets it anyway.
 */
export const AlephaCache = $module({
  name: "alepha.cache",
  primitives: [$cache],
  services: [CacheProvider],
  variants: [
    MemoryCacheProvider,
    CloudflareKVProvider,
    CloudflareCacheProvider,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: CacheProvider,
      use: CloudflareCacheProvider,
    });
  },
});
