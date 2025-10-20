import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $proxy } from "./descriptors/$proxy.ts";
import { ServerProxyProvider } from "./providers/ServerProxyProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$proxy.ts";
export * from "./providers/ServerProxyProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha that provides a proxy server functionality.
 *
 * @see {@link $proxy}
 * @module alepha.server.proxy
 */
export const AlephaServerProxy = $module({
  name: "alepha.server.proxy",
  descriptors: [$proxy],
  services: [AlephaServer, ServerProxyProvider],
});
