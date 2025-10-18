import { $module } from "@alepha/core";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$config.ts";
export * from "./entities/parameters.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides parameter management API endpoints for Alepha applications.
 *
 * This module includes configuration parameter storage, retrieval,
 * and dynamic application settings management.
 *
 * @module alepha.api.parameters
 */
export const AlephaApiParameters = $module({
	name: "alepha.api.parameters",
	services: [],
});
