import { $module } from "@alepha/core";
import { DevtoolsProvider } from "./DevtoolsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./DevtoolsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Developer tools module for monitoring and debugging Alepha applications.
 *
 * This module provides comprehensive data collection capabilities for tracking application behavior,
 * performance metrics, and debugging information in real-time.
 *
 * @see {@link DevtoolsProvider}
 * @module alepha.devtools
 */
export const AlephaDevtools = $module({
	name: "alepha.devtools",
	descriptors: [],
	services: [DevtoolsProvider],
});
