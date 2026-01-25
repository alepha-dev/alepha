import { $module } from "alepha";
import { $cors } from "./primitives/$cors.ts";
import {
  type CorsOptions,
  ServerCorsProvider,
} from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cors.ts";
export * from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ServerRoute {
    /**
     * Route-specific CORS configuration.
     * If set, overrides the global CORS options for this route.
     */
    cors?: CorsOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Cross-Origin Resource Sharing configuration.
 *
 * **Features:**
 * - CORS policy definition
 *
 * @module alepha.server.cors
 */
export const AlephaServerCors = $module({
  name: "alepha.server.cors",
  primitives: [$cors],
  services: [ServerCorsProvider],
});
