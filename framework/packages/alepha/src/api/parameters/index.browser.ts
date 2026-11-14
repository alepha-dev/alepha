import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/parameters.ts";
export * from "./schemas/activateParameterBodySchema.ts";
export * from "./schemas/adminDashboardLayoutResponseSchema.ts";
export * from "./schemas/adminDashboardLayoutSchema.ts";
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
export * from "./schemas/setAdminDashboardLayoutBodySchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiParameters = $module({
  name: "alepha.api.parameters",
  services: [],
});
