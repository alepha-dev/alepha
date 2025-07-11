import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerMetricsProvider } from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Server Metrics Module
 *
 * This module provides prometheus metrics for the Alepha server.
 * Metrics are exposed at the `/metrics` endpoint.
 *
 * @see {@link ServerMetricsProvider}
 * @module alepha.server.metrics
 */
export class AlephaServerMetrics implements Module {
	public readonly name = "alepha.server.metrics";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer);
		alepha.with(ServerMetricsProvider);
	};
}
