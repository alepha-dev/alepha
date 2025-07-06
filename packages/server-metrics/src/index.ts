import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerMetricsProvider } from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServerMetrics implements Module {
	public readonly name = "alepha.server.metrics";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer);
		alepha.with(ServerMetricsProvider);
	};
}
