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
 *   when `AlephaApiJobsQueue` is *not* loaded.
 *
 * **Direct mode is a different reliability contract on Cloudflare, not
 * just the cheaper option.** On long-running Node it is genuinely equivalent
 * to queue mode minus the broker. On Workers it is not: `DirectJobDispatcher`
 * keeps the isolate alive through `executionCtx.waitUntil`, which Cloudflare
 * caps at about **30 seconds after the response**. That is the whole budget a
 * job pushed from a request gets, a declared `timeout` longer than it is
 * unreachable, and because crash recovery is derived as twice the declared
 * timeout, a job killed at the budget sits `running` for twice its timeout
 * before the sweep will consider it crashed. A local timer armed after the
 * response never fires there either, so delayed work and retry backoff both
 * fall back to sweep granularity. The build warns about the timeouts it can
 * see; the rest is inherent.
 *
 * **{@link AlephaApiJobsQueue} is the answer to all of that**, and the
 * recommended path for anything long-running or high-volume on Cloudflare: a
 * queue consumer gets 15 minutes of wall clock AND 15 minutes of CPU, the
 * most generous surface Cloudflare offers, and the transport can hold a
 * delayed message so retries land on their backoff rather than on the sweep.
 *
 * **Retries** use exponential backoff with full jitter (`retryBackoffBase`,
 * `retryBackoffMax`). The outbox row's `scheduledAt` is the truth and the
 * sweep is the backstop, so what varies by runtime is only how soon anything
 * looks at it: exactly, on Node in either dispatch mode and on Workers behind
 * a queue; at the next `sweepCron` tick in direct mode on Workers. Cron jobs
 * that declare `retry` go through the same outbox path - a transient failure
 * no longer means waiting for the next cron tick (useful for once-daily
 * jobs). For a payload that expires before any of that, `push(payload,
 * { inline: true })` runs the handler in front of the caller and fails
 * terminally instead of retrying.
 *
 * **Cloudflare budgets, in one place:**
 *
 * | | |
 * |---|---|
 * | `waitUntil` after a response (direct mode) | ~30 s |
 * | Cron Trigger wall clock | 15 min |
 * | Cron Trigger CPU | 30 s under an hourly interval, 15 min at or above |
 * | Queue consumer | 15 min wall AND 15 min CPU |
 * | Cron Triggers per **account** | 5 free, 250 paid |
 *
 * The last one is per account rather than per Worker, so two Alepha apps can
 * exceed it between them. The build warns past five and names the
 * expressions; the fix is to give jobs that do not need their own cadence a
 * shared one.
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
 * **On Cloudflare this is the recommended path for anything long-running or
 * high-volume**, not an optimisation. See {@link AlephaApiJobs} for the
 * budgets direct mode is held to there; a queue consumer gets 15 minutes of
 * wall clock AND 15 minutes of CPU instead of ~30 seconds of `waitUntil`,
 * and the transport can hold a delayed message so retries land on their
 * backoff. Set `CLOUDFLARE_QUEUE_NAME` and the build emits the producer
 * binding, the consumer, and its dead-letter queue.
 *
 * ⚠️ **Nothing consumes that dead-letter queue, and it catches less than it
 * looks.** `WorkerdWorkerProvider` deliberately lets `JobProvider` absorb
 * handler errors, so `msg.retry()` only fires on infrastructure failures:
 * the DLQ collects undecodable envelopes and broker failures, never a failed
 * job. Failed jobs are recorded on the outbox row and shown in the admin UI,
 * which is where to look. Nothing surfaces the DLQ's depth.
 *
 * @module alepha.api.jobs.queue
 */
export const AlephaApiJobsQueue = $module({
  name: "alepha.api.jobs.queue",
  imports: [AlephaApiJobs, AlephaQueue],
  services: [JobQueueProvider],
});
