import { $module } from "alepha";

import {
  type CorsOptions,
  ServerCorsProvider,
} from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/CAPACITOR_ORIGINS.ts";
export * from "./primitives/$cors.ts";
export * from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ServerRoute {
    /**
     * Route-specific CORS configuration (settable via `$route`).
     * If set, overrides the global CORS options for this route;
     * omitted fields fall back to the global values.
     */
    cors?: Partial<CorsOptions>;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cross-Origin Resource Sharing configuration.
 *
 * **Features:**
 * - CORS policy definition
 * - `CAPACITOR_ORIGINS`, the two WebView origins of a Capacitor app
 *
 * @module alepha.server.cors
 */
export const AlephaServerCors = $module({
  name: "alepha.server.cors",
  services: [ServerCorsProvider],
});
