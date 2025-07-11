import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerHelmetProvider } from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Server Helmet Module
 *
 * Automatically adds important HTTP security headers to every response
 * to help protect your application from common web vulnerabilities.
 *
 * @see {@link ServerHelmetProvider}
 * @module alepha.server.helmet
 */
export class AlephaServerHelmet implements Module {
	public readonly name = "alepha.server.helmet";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer).with(ServerHelmetProvider);
	};
}
