import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $proxy } from "./primitives/$proxy.ts";
import { ServerProxyProvider } from "./providers/ServerProxyProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$proxy.ts";
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
  primitives: [$proxy],
  services: [AlephaServer, ServerProxyProvider],
});
