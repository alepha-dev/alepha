import { $module } from "alepha";
import { ConfigController } from "./controllers/ConfigController.ts";
import { ConfigActivationScheduler } from "./schedulers/ConfigActivationScheduler.ts";
import { ConfigStore } from "./services/ConfigStore.ts";

// ---------------------------------------------------------------------------------------------------------------------

// Controller exports
export * from "./controllers/ConfigController.ts";
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
 * Provides versioned configuration management for Alepha applications.
 *
 * Features:
 * - Type-safe, versioned configuration with `$config` primitive
 * - Schema validation with auto-migration detection
 * - Scheduled activation (FUTURE, NEXT, CURRENT, EXPIRED statuses)
 * - PostgreSQL persistence with full version history
 * - Cross-instance synchronization via topic
 * - Tree view support via dot-notation naming
 * - REST API for configuration management
 * - Automatic activation scheduler
 *
 * @example
 * ```ts
 * import { Alepha } from "alepha";
 * import { AlephaApiParameters } from "alepha/api/parameters";
 *
 * const alepha = Alepha.create();
 * alepha.with(AlephaApiParameters);
 *
 * // Then use $config in your services:
 * class AppConfig {
 *   features = $config({
 *     name: "app.features.flags",
 *     schema: t.object({
 *       enableBeta: t.boolean(),
 *       maxUploadSize: t.number()
 *     }),
 *     default: { enableBeta: false, maxUploadSize: 10485760 }
 *   });
 * }
 * ```
 *
 * @module alepha.api.parameters
 */
export const AlephaApiParameters = $module({
  name: "alepha.api.parameters",
  services: [ConfigStore, ConfigController, ConfigActivationScheduler],
});
