import { AlephaCache } from "@alepha/cache";
import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerCacheProvider } from "./providers/ServerCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * # Alepha Server Cache Module
 *
 * @description
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
export class AlephaServerCache implements Module {
	public readonly name = "alepha.server.cache";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(AlephaServer).with(AlephaCache).with(ServerCacheProvider);
}
