import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerMetricsProvider } from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMetricsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Prometheus-style metrics collection.
 *
 * **Features:**
 * - Prometheus-style metrics
 * - Custom metric registration
 * - Metric exposition endpoint
 *
 * @module alepha.server.metrics
 */
export const AlephaServerMetrics = $module({
  name: "alepha.server.metrics",
  services: [AlephaServer, ServerMetricsProvider],
});
