import { $module } from "alepha";
import { ParameterAudits } from "./audits/ParameterAudits.ts";
import { AdminParameterController } from "./controllers/AdminParameterController.ts";
import { $parameter } from "./primitives/$parameter.ts";
import { ParameterProvider } from "./services/ParameterProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

// Controller exports
export * from "./audits/ParameterAudits.ts";
export * from "./controllers/AdminParameterController.ts";
// Entity exports
export * from "./entities/parameters.ts";
// Primitive exports
export * from "./primitives/$parameter.ts";
// Schema exports (types for UI)
export * from "./schemas/activateParameterBodySchema.ts";
export * from "./schemas/createParameterVersionBodySchema.ts";
export * from "./schemas/parameterCurrentResponseSchema.ts";
export * from "./schemas/parameterHistoryResponseSchema.ts";
export * from "./schemas/parameterNameParamSchema.ts";
export * from "./schemas/parameterNamesResponseSchema.ts";
export * from "./schemas/parameterResponseSchema.ts";
export * from "./schemas/parameterStatusSchema.ts";
export * from "./schemas/parameterTreeNodeSchema.ts";
export * from "./schemas/parameterVersionParamSchema.ts";
export * from "./schemas/parameterVersionResponseSchema.ts";
export * from "./schemas/rollbackParameterBodySchema.ts";
// Service exports
export * from "./services/ParameterProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Application parameter management.
 *
 * **Features:**
 * - Versioned parameter definitions
 * - Status derived from activationDate at query time
 * - Schema validation with migration detection
 * - Cross-instance notification via pub/sub
 * - Async `.get()` with lazy loading (works in Node and Cloudflare Workers)
 *
 * @module alepha.api.parameters
 */
export const AlephaApiParameters = $module({
  name: "alepha.api.parameters",
  primitives: [$parameter],
  services: [ParameterProvider, AdminParameterController],
  variants: [ParameterAudits],
});
