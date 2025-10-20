import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $serve } from "./descriptors/$serve.ts";
import { ServerStaticProvider } from "./providers/ServerStaticProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$serve.ts";
export * from "./providers/ServerStaticProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Create static file server with `$static()`.
 *
 * @see {@link ServerStaticProvider}
 * @module alepha.server.static
 */
export const AlephaServerStatic = $module({
  name: "alepha.server.static",
  descriptors: [$serve],
  services: [AlephaServer, ServerStaticProvider],
});
