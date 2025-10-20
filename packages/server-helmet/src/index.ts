import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerHelmetProvider } from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Automatically adds important HTTP security headers to every response
 * to help protect your application from common web vulnerabilities.
 *
 * @see {@link ServerHelmetProvider}
 * @module alepha.server.helmet
 */
export const AlephaServerHelmet = $module({
  name: "alepha.server.helmet",
  services: [AlephaServer, ServerHelmetProvider],
});
