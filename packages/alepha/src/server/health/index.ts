import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerHealthProvider } from "./providers/ServerHealthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerHealthProvider.ts";
export * from "./schemas/healthSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Application health monitoring endpoints.
 *
 * **Features:**
 * - `GET /health` endpoint
 *
 * @module alepha.server.health
 */
export const AlephaServerHealth = $module({
  name: "alepha.server.health",
  services: [AlephaServer, ServerHealthProvider],
});
