import { $module } from "alepha";
import { AlephaBackground } from "alepha/background";
import type { DateTime } from "alepha/datetime";
import { AlephaLock } from "alepha/lock";
import { AlephaQueue } from "alepha/queue";
import { AlephaScheduler } from "alepha/scheduler";
import { AdminJobController } from "./controllers/AdminJobController.ts";
import { $job } from "./primitives/$job.ts";
import { DirectJobDispatcher } from "./providers/DirectJobDispatcher.ts";
import { JobProvider } from "./providers/JobProvider.ts";
import { JobQueueProvider } from "./providers/JobQueueProvider.ts";
import { JobService } from "./services/JobService.ts";

// -----------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminJobController.ts";
export * from "./entities/jobExecutionEntity.ts";
export * from "./primitives/$job.ts";
export * from "./providers/DirectJobDispatcher.ts";
export * from "./providers/JobDispatcher.ts";
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
 * Job execution framework - cron and durable queue work with a single primitive.
 *
 * A `$job` is either **cron-only** (declares `cron`) or **payload-only** (declares `schema`).
 *
 * **Three runtime modes:**
 *
 * - **cron**: fires on a schedule. Cron-mode jobs are protected by a
 *   distributed lock by default (`lock: true`), so multi-replica Docker
 *   deployments only run the handler once per tick. Override with
 *   `lock: false` if you genuinely want every replica to fire.
 * - **queue**: push-driven, dispatched through the queue infrastructure
 *   (`AlephaQueue`, e.g. Cloudflare Queues, Redis). Real-time delivery,
 *   ideal for high-volume systems. Requires `AlephaApiJobsQueue`.
 * - **direct**: push-driven, processed in-process right after the caller
 *   awaits the push. The DB outbox row is the durability guarantee - if
 *   the process dies, the reconciliation sweep re-dispatches. Default
 *   when `AlephaApiJobsQueue` is *not* loaded. Best for cheap deployments
 *   (Cloudflare Workers, single-instance Node) where standing up a queue
 *   is overkill.
 *
 * **Retries** are sweep-driven across all modes (no exponential backoff).
 * Granularity is bounded by `sweepCron` (default 15 min). The first retry
 * may land anywhere from a few seconds to ~15 min later depending on when
 * the next sweep tick fires. Cron jobs that declare `retry` go through
 * the same sweep path - a transient failure no longer means waiting for
 * the next cron tick (useful for once-daily jobs).
 *
 * **Runtime support for cron triggers**
 *
 * - **Long-running Node / Docker**: `CronProvider` runs an in-process
 *   timer loop. Multi-replica deployments serialize ticks via the cron
 *   lock (see `$job.lock`).
 * - **Cloudflare Workers**: the build emits cron expressions into
 *   `wrangler.jsonc`; Cloudflare invokes the worker on schedule and the
 *   `cloudflare:scheduled` hook routes the event to the matching jobs.
 * - **Generic serverless**: a platform entry point can POST
 *   `/_alepha/cron/:name`; the handler emits `serverless:cron` and
 *   `CronProvider` runs the matching job. Set `CRON_SECRET` to require
 *   authenticated calls.
 *
 * @module alepha.api.jobs
 */
export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  primitives: [$job],
  imports: [AlephaScheduler, AlephaLock, AlephaBackground],
  services: [JobProvider, JobService, AdminJobController, DirectJobDispatcher],
});

/**
 * Queue support for `$job`. Import alongside {@link AlephaApiJobs} when your
 * app declares queue-mode jobs (any `$job` with a `schema`) and you want a
 * real queue (e.g. Cloudflare Queues, Redis) instead of in-process direct
 * execution.
 *
 * Adds `JobQueueProvider` to the container. `JobProvider` detects its
 * presence at start-up and routes dispatches through it.
 *
 * @module alepha.api.jobs.queue
 */
export const AlephaApiJobsQueue = $module({
  name: "alepha.api.jobs.queue",
  imports: [AlephaApiJobs, AlephaQueue],
  services: [JobQueueProvider],
});
