import { $module } from "alepha";
import { AdminConfigController } from "./controllers/AdminConfigController.ts";
import { $config } from "./primitives/$config.ts";
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
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.9.0 | node, bun, workerd|
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
  primitives: [$config],
  services: [ConfigStore, AdminConfigController, ConfigActivationScheduler],
});
