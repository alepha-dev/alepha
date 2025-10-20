import { $module } from "@alepha/core";
import {
  ServerCorsProvider,
  type ServerCorsProviderOptions,
} from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for configuring CORS on the Alepha server.
 */
export const AlephaServerCors = $module<ServerCorsProviderOptions>({
  name: "alepha.server.cors",
  services: [ServerCorsProvider],
  register: (alepha, options) => alepha.with(ServerCorsProvider, options),
});
