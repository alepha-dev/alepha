import { $module, type Alepha, type Static, t } from "alepha";
import type { DateTime } from "alepha/datetime";
import { AlephaLock } from "alepha/lock";
import { AlephaQueue } from "alepha/queue";
import { AlephaScheduler } from "alepha/scheduler";
import { AdminJobController } from "./controllers/AdminJobController.ts";
import { JobProvider } from "./providers/JobProvider.ts";
import { JobQueueProvider } from "./providers/JobQueueProvider.ts";
import { JobService } from "./services/JobService.ts";

// -----------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminJobController.ts";
export * from "./entities/jobExecutionEntity.ts";
export * from "./entities/jobExecutionLogEntity.ts";
export * from "./primitives/$job.ts";
export * from "./providers/JobProvider.ts";
export * from "./providers/JobQueueProvider.ts";
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
  interface Env extends Partial<Static<typeof jobEnvSchema>> {}

  interface Hooks {
    "job:begin": { name: string; now: DateTime; executionId: string };
    "job:success": { name: string; executionId: string };
    "job:error": { name: string; error: Error; executionId: string };
    "job:cancel": { name: string; executionId: string };
    "job:end": { name: string; executionId: string };
  }
}

// -----------------------------------------------------------------------------------------------------------------

const jobEnvSchema = t.object({
  /**
   * Controls whether the job system dispatches work through a queue or executes inline.
   *
   * - `1` — always use queue (force queue even in serverless)
   * - `0` — never use queue (force inline, useful for testing)
   * - not set — auto: use queue when NOT serverless (default)
   */
  ALEPHA_JOBS_QUEUE: t.optional(
    t.integer({
      description:
        "Set to 1 to always use queue, 0 to disable queue (default: auto-detect based on environment)",
    }),
  ),
});

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
  imports: [AlephaScheduler, AlephaLock],
  services: [JobProvider, JobService, AdminJobController],
  // AlephaQueue + JobQueueProvider are conditional — injected only when queue is enabled.
  variants: [JobQueueProvider],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(jobEnvSchema);
    const useQueue =
      env.ALEPHA_JOBS_QUEUE === 1
        ? true
        : env.ALEPHA_JOBS_QUEUE === 0
          ? false
          : !alepha.isServerless();

    if (useQueue) {
      alepha.with(AlephaQueue);
      alepha.with(JobQueueProvider);
    }
  },
});
