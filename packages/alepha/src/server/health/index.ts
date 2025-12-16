import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerHealthProvider } from "./providers/ServerHealthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerHealthProvider.ts";
export * from "./schemas/healthSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Server that provides health-check endpoints.
 *
 * @see {@link ServerHealthProvider}
 * @module alepha.server.health
 */
export const AlephaServerHealth = $module({
  name: "alepha.server.health",
  services: [AlephaServer, ServerHealthProvider],
});
