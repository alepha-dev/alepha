import { $module } from "alepha";
import { AdminJobController } from "./controllers/AdminJobController.ts";
import { JobProvider } from "./providers/JobProvider.ts";
import { JobService } from "./services/JobService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminJobController.ts";
export * from "./entities/jobExecutions.ts";
export * from "./primitives/$job.ts";
export * from "./providers/JobProvider.ts";
export * from "./schemas/jobExecutionQuerySchema.ts";
export * from "./schemas/jobExecutionResourceSchema.ts";
export * from "./schemas/triggerJobSchema.ts";
export * from "./services/JobService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Job execution monitoring.
 *
 * **Features:**
 * - Job definitions for tracking
 * - Job status tracking
 * - Execution history
 * - Retry management
 *
 * @module alepha.api.jobs
 */
export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  services: [AdminJobController, JobProvider, JobService],
});
