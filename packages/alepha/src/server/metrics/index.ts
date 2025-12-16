import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerMetricsProvider } from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * This module provides prometheus metrics for the Alepha server.
 * Metrics are exposed at the `/metrics` endpoint.
 *
 * @see {@link ServerMetricsProvider}
 * @module alepha.server.metrics
 */
export const AlephaServerMetrics = $module({
  name: "alepha.server.metrics",
  services: [AlephaServer, ServerMetricsProvider],
});
