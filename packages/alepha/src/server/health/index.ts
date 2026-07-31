import { $module } from "alepha";
import { AlephaServer } from "alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

export {
  healthSchema,
  ServerHealthProvider,
} from "alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Application health monitoring endpoints.
 *
 * **Features:**
 * - `GET /health` and `GET /healthz`
 *
 * @deprecated `/health` is part of `AlephaServer` since it became what
 * supervisors read to tell a listening app from a serving one — an app cannot
 * usefully opt out of being checkable. Importing this module is now a no-op
 * beyond `AlephaServer` itself; drop it.
 *
 * @module alepha.server.health
 */
export const AlephaServerHealth = $module({
  name: "alepha.server.health",
  services: [AlephaServer],
});
