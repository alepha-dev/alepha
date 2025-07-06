import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerCorsProvider } from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCorsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServerCors implements Module {
	public readonly name = "alepha.server.cors";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer).with(ServerCorsProvider);
	};
}
