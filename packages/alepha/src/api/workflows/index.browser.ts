import { $module } from "alepha";

// -----------------------------------------------------------------------------------------------------------------

export * from "./entities/workflowExecutions.ts";
export * from "./entities/workflowStepExecutions.ts";
export * from "./entities/workflowStepLogs.ts";
export * from "./schemas/workflowActivityQuerySchema.ts";
export * from "./schemas/workflowActivitySchema.ts";
export * from "./schemas/workflowConfigAtom.ts";
export * from "./schemas/workflowExecutionDetailSchema.ts";
export * from "./schemas/workflowExecutionQuerySchema.ts";
export * from "./schemas/workflowExecutionResourceSchema.ts";
export * from "./schemas/workflowRegistrationSchema.ts";
export * from "./schemas/workflowStatsSchema.ts";
export * from "./schemas/workflowStepExecutionResourceSchema.ts";

// -----------------------------------------------------------------------------------------------------------------

export const AlephaApiWorkflows = $module({
  name: "alepha.api.workflows",
  services: [],
});
