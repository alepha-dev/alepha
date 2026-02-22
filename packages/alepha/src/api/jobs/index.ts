import { $module } from "alepha";
import { AlephaBatch } from "alepha/batch";
import type { DateTime } from "alepha/datetime";
import { AlephaLock } from "alepha/lock";
import { AlephaQueue } from "alepha/queue";
import { AlephaScheduler } from "alepha/scheduler";
import { AdminJobController } from "./controllers/AdminJobController.ts";
import { JobProvider } from "./providers/JobProvider.ts";
import { JobService } from "./services/JobService.ts";

// -----------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminJobController.ts";
export * from "./entities/jobExecutionEntity.ts";
export * from "./entities/jobExecutionLogEntity.ts";
export * from "./primitives/$job.ts";
export * from "./providers/JobProvider.ts";
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
export * from "./services/JobService.ts";

// -----------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    "job:begin": { name: string; now: DateTime; executionId: string };
    "job:success": { name: string; executionId: string };
    "job:error": { name: string; error: Error; executionId: string };
    "job:cancel": { name: string; executionId: string };
    "job:end": { name: string; executionId: string };
  }
}

// -----------------------------------------------------------------------------------------------------------------

/**
 * Job execution framework — unified primitive for deferred, scheduled, and queued work.
 *
 * **Features:**
 * - Push-based jobs with typed payloads
 * - Cron scheduling with execution tracking
 * - Retry with exponential backoff
 * - Priority, delay, cancellation
 * - Deduplication via unique keys
 * - Per-execution log capture
 *
 * @module alepha.api.jobs
 */
export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  services: [
    AlephaQueue,
    AlephaScheduler,
    AlephaLock,
    AlephaBatch,
    JobProvider,
    JobService,
    AdminJobController,
  ],
});
