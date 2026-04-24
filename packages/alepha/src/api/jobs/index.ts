import { $module } from "alepha";
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
export * from "./primitives/$job.ts";
export * from "./providers/JobProvider.ts";
export * from "./providers/JobQueueProvider.ts";
export * from "./schemas/jobConfigAtom.ts";
export * from "./schemas/jobExecutionQuerySchema.ts";
export * from "./schemas/jobExecutionResourceSchema.ts";
export * from "./schemas/jobRegistrationSchema.ts";
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
 * Job execution framework — cron and durable queue work with a single primitive.
 *
 * A `$job` is either **cron-only** (declares `cron`) or **queue-only** (declares `schema`).
 * Cron jobs run inline on their schedule and only record errors by default.
 * Queue jobs use the outbox pattern: push commits to DB first, then notifies via queue.
 *
 * **This module provides cron support only.** To enable queue-mode jobs, also
 * import {@link AlephaApiJobsQueue} — it brings in the queue layer and infrastructure
 * binding (e.g. Cloudflare Queues). Cron-only deployments (Vercel, CF-without-Queues)
 * do not need `AlephaApiJobsQueue`.
 *
 * @module alepha.api.jobs
 */
export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  imports: [AlephaScheduler, AlephaLock],
  services: [JobProvider, JobService, AdminJobController],
});

/**
 * Queue support for `$job`. Import alongside {@link AlephaApiJobs} when your
 * app declares queue-mode jobs (any `$job` with a `schema`).
 *
 * Adds `JobQueueProvider` which plumbs the outbox dispatch through `AlephaQueue`.
 *
 * @module alepha.api.jobs.queue
 */
export const AlephaApiJobsQueue = $module({
  name: "alepha.api.jobs.queue",
  imports: [AlephaApiJobs, AlephaQueue],
  services: [JobQueueProvider],
});
