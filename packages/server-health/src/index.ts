import type { Alepha } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerHealthProvider } from "./providers/ServerHealthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerHealthProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Server that provides health-check endpoints.
 *
 * @see {@link ServerHealthProvider}
 * @module alepha.server.health
 */
export class AlephaServerHealth {
	public readonly name = "alepha.server.health";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer).with(ServerHealthProvider);
	};
}
