import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerRateLimitProvider } from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServerRateLimit implements Module {
	public readonly name = "alepha.server.rate-limit";
	public readonly $services = (alepha: Alepha) => {
		alepha.with(AlephaServer).with(ServerRateLimitProvider);
	};
}
