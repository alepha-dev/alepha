import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/jobExecutions.ts";
export * from "./schemas/jobExecutionQuerySchema.ts";
export * from "./schemas/jobExecutionResourceSchema.ts";
export * from "./schemas/triggerJobSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  services: [],
});
