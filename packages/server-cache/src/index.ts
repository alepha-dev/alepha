import { AlephaCache } from "@alepha/cache";
import { $module } from "@alepha/core";
import { ServerCacheProvider } from "./providers/ServerCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Server that provides server-side caching capabilities.
 * It uses the Alepha Cache module to cache responses from server actions ($action).
 * It also provides a ETag-based cache invalidation mechanism.
 *
 * @example
 * ```ts
 * import { Alepha } from "alepha";
 * import { $action } from "alepha/server";
 * import { AlephaServerCache } from "alepha/server/cache";
 *
 * class ApiServer {
 *   hello = $action({
 *     cache: true,
 *     handler: () => "Hello, World!",
 *   });
 * }
 *
 * const alepha = Alepha.create()
 *   .with(AlephaServerCache)
 *   .with(ApiServer);
 *
 * run(alepha);
 * ```
 *
 * @see {@link ServerCacheProvider}
 * @module alepha.server.cache
 */
export const AlephaServerCache = $module({
  name: "alepha.server.cache",
  services: [AlephaCache, ServerCacheProvider],
});
