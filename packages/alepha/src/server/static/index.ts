import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $serve } from "./primitives/$serve.ts";
import { ServerStaticProvider } from "./providers/ServerStaticProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$serve.ts";
export * from "./providers/ServerStaticProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Infer file serving.
 *
 * **Features:**
 * - Serve static files from directory
 *
 * @module alepha.server.static
 */
export const AlephaServerStatic = $module({
  name: "alepha.server.static",
  primitives: [$serve],
  services: [AlephaServer, ServerStaticProvider],
});
