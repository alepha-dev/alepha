import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerRateLimitProvider } from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServerRateLimit = $module({
	name: "alepha.server.rate-limit",
	services: [AlephaServer, ServerRateLimitProvider],
});
