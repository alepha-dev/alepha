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
 * Plugin for configuring CORS on the Alepha server.
 *
 * @example
 * ```ts
 * import { Alepha, $route } from "alepha";
 * import { AlephaServerCors, $cors } from "alepha/server-cors";
 *
 * class ApiService {
 *   // Global CORS is applied via corsOptions atom
 *
 *   // Path-specific CORS for API routes
 *   apiCors = $cors({
 *     paths: ["/api/*"],
 *     origin: "https://app.example.com",
 *     credentials: true,
 *   });
 *
 *   route = $route({
 *     path: "/api/data",
 *     method: "POST",
 *     handler: () => ({ data: "hello" }),
 *   });
 * }
 * ```
 */
export const AlephaServerCors = $module({
  name: "alepha.server.cors",
  primitives: [$cors],
  services: [ServerCorsProvider],
});
