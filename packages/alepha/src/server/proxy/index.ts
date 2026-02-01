import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $proxy } from "./primitives/$proxy.ts";
import { ServerProxyProvider } from "./providers/ServerProxyProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$proxy.ts";
export * from "./providers/ServerProxyProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 2 - beta | 0.12.0 | node, bun|
 *
 * Reverse proxy routing.
 *
 * **Features:**
 * - Proxy configuration and routing
 *
 * @module alepha.server.proxy
 */
export const AlephaServerProxy = $module({
  name: "alepha.server.proxy",
  primitives: [$proxy],
  services: [AlephaServer, ServerProxyProvider],
});
