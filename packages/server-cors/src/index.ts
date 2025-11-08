import { $module } from "@alepha/core";
import { ServerCorsProvider } from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for configuring CORS on the Alepha server.
 */
export const AlephaServerCors = $module({
  name: "alepha.server.cors",
  services: [ServerCorsProvider],
});
