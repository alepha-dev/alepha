import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $basicAuth } from "./descriptors/$basicAuth.ts";
import type { BasicAuthOptions } from "./providers/ServerBasicAuthProvider.ts";
import { ServerBasicAuthProvider } from "./providers/ServerBasicAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$basicAuth.ts";
export * from "./providers/ServerBasicAuthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ServerRoute {
    /**
     * Basic authentication configuration for this route.
     * When specified, the route will require HTTP Basic Authentication.
     */
    basicAuth?: BasicAuthOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides HTTP Basic Authentication for server routes with configurable credentials.
 *
 * The server-basic-auth module enables HTTP Basic Authentication using the `basicAuth` option
 * in action descriptors or through the `$basicAuth` descriptor for global path-based protection.
 *
 * Features:
 * - Per-route authentication via action options
 * - Global authentication with path filtering
 * - Multiple auth instances support
 * - Standard HTTP Basic Authentication (RFC 7617)
 *
 * @see {@link $basicAuth}
 * @module alepha.server.basic-auth
 */
export const AlephaServerBasicAuth = $module({
  name: "alepha.server.basic-auth",
  descriptors: [$basicAuth],
  services: [AlephaServer, ServerBasicAuthProvider],
});
