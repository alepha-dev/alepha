import { $module } from "alepha";

// -----------------------------------------------------------------------------------------------------------------

export * from "./entities/jobExecutionEntity.ts";
export * from "./schemas/jobConfigAtom.ts";
export * from "./schemas/jobExecutionQuerySchema.ts";
export * from "./schemas/jobExecutionResourceSchema.ts";
export * from "./schemas/jobRegistrationSchema.ts";
export * from "./schemas/triggerJobSchema.ts";

// -----------------------------------------------------------------------------------------------------------------

export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  services: [],
});

export const AlephaApiJobsQueue = $module({
  name: "alepha.api.jobs.queue",
  services: [],
});
