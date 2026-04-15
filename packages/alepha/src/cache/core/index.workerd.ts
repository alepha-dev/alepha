import { $module } from "alepha";
import { $cache } from "./primitives/$cache.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { CloudflareKVProvider } from "./providers/CloudflareKVProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cache.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/CloudflareKVProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaCache = $module({
  name: "alepha.cache",
  primitives: [$cache],
  services: [CacheProvider],
  variants: [MemoryCacheProvider, CloudflareKVProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: CacheProvider,
      use: CloudflareKVProvider,
    });
  },
});
