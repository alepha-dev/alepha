import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/parameters.ts";
export * from "./primitives/$config.ts";

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
