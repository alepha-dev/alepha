import { $module } from "alepha";

// -----------------------------------------------------------------------------------------------------------------

export * from "./entities/jobExecutionEntity.ts";
export * from "./entities/jobExecutionLogEntity.ts";
export * from "./schemas/jobActivitySchema.ts";
export * from "./schemas/jobConfigAtom.ts";
export * from "./schemas/jobCronInfoSchema.ts";
export * from "./schemas/jobExecutionDetailResourceSchema.ts";
export * from "./schemas/jobExecutionQuerySchema.ts";
export * from "./schemas/jobExecutionResourceSchema.ts";
export * from "./schemas/jobFailureSchema.ts";
export * from "./schemas/jobQueueDepthSchema.ts";
export * from "./schemas/jobRegistrationSchema.ts";
export * from "./schemas/jobStatsSchema.ts";
export * from "./schemas/triggerJobSchema.ts";

// -----------------------------------------------------------------------------------------------------------------

export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  services: [],
});
