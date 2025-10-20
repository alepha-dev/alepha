import { $module } from "@alepha/core";
import { AlephaScheduler } from "@alepha/scheduler";
import { JobController } from "./controllers/JobController.ts";
import { JobService } from "./services/JobService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/JobController.ts";
export * from "./entities/jobExecutions.ts";
export * from "./schemas/jobExecutionQuerySchema.ts";
export * from "./schemas/jobExecutionResourceSchema.ts";
export * from "./schemas/triggerJobSchema.ts";
export * from "./services/JobService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides job management API endpoints for Alepha applications.
 *
 * This module includes job queue operations, job status monitoring,
 * and background task management capabilities.
 *
 * @module alepha.api.jobs
 */
export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  services: [AlephaScheduler, JobController, JobService],
});
