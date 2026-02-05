import { $module } from "alepha";
import { AdminParameterController } from "./controllers/AdminParameterController.ts";
import { $parameter } from "./primitives/$parameter.ts";
import { ParameterActivationScheduler } from "./schedulers/ParameterActivationScheduler.ts";
import { ParameterStore } from "./services/ParameterStore.ts";

// ---------------------------------------------------------------------------------------------------------------------

// Controller exports
export * from "./controllers/AdminParameterController.ts";
// Entity exports
export * from "./entities/parameters.ts";
// Primitive exports
export * from "./primitives/$parameter.ts";
// Scheduler exports
export * from "./schedulers/ParameterActivationScheduler.ts";
// Schema exports (types for UI)
export * from "./schemas/index.ts";
// Service exports
export * from "./services/ParameterStore.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.9.0 | node, bun, workerd|
 *
 * Application parameter management.
 *
 * **Features:**
 * - Versioned parameter definitions
 * - Scheduled activation (FUTURE, NEXT, CURRENT, EXPIRED)
 * - Schema validation with migration detection
 * - Cross-instance sync via pub/sub
 *
 * @module alepha.api.parameters
 */
export const AlephaApiParameters = $module({
  name: "alepha.api.parameters",
  primitives: [$parameter],
  services: [
    ParameterStore,
    AdminParameterController,
    ParameterActivationScheduler,
  ],
});
