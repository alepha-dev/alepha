import { $module } from "alepha";
import { AlephaCache } from "alepha/cache";
import { ServerCacheProvider } from "./providers/ServerCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.10.0 | node, bun, workerd|
 *
 * ETag-based response caching.
 *
 * **Features:**
 * - ETag generation and validation
 * - Conditional request handling
 *
 * @module alepha.server.cache
 */
export const AlephaServerCache = $module({
  name: "alepha.server.cache",
  services: [AlephaCache, ServerCacheProvider],
});
