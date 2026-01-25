import { $module } from "alepha";
import { AdminConfigController } from "./controllers/AdminConfigController.ts";
import { ConfigActivationScheduler } from "./schedulers/ConfigActivationScheduler.ts";
import { ConfigStore } from "./services/ConfigStore.ts";

// ---------------------------------------------------------------------------------------------------------------------

// Controller exports
export * from "./controllers/AdminConfigController.ts";
// Entity exports
export * from "./entities/parameters.ts";
// Primitive exports
export * from "./primitives/$config.ts";
// Scheduler exports
export * from "./schedulers/ConfigActivationScheduler.ts";
// Service exports
export * from "./services/ConfigStore.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Application configuration management.
 *
 * **Features:**
 * - Versioned configuration definitions
 * - Scheduled activation (FUTURE, NEXT, CURRENT, EXPIRED)
 * - Schema validation with migration detection
 * - Cross-instance sync via pub/sub
 *
 * @module alepha.api.parameters
 */
export const AlephaApiParameters = $module({
  name: "alepha.api.parameters",
  services: [ConfigStore, AdminConfigController, ConfigActivationScheduler],
});
