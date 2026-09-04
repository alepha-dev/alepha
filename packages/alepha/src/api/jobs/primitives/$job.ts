import {
  $inject,
  type Async,
  createPrimitive,
  type Infer,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
  type ZType,
} from "alepha";
import type { DateTime, DurationLike } from "alepha/datetime";

import {
  type CancelContext,
  JobProvider,
  type JobTriggerContext,
  type PushManyItem,
  type PushOptions,
} from "../providers/JobProvider.ts";

/**
 * Job primitive for defining scheduled (cron) or queued (push) tasks.
 *
 * A job must be either **cron-only** (pass `cron`) or **queue-only**
 * (pass `schema`), never both. To run scheduled work that processes
 * payloads, compose two jobs: a cron that pushes payloads, and a
 * queue job that handles them.
 */
export const $job = <T extends ZType = ZType>(
  options: JobPrimitiveOptions<T>,
): JobPrimitive<T> => {
  return createPrimitive(JobPrimitive<T>, options);
};

// -----------------------------------------------------------------------------------------------------------------

export interface JobHandlerArgs<T extends ZType = ZType> {
  payload: Infer<T>;
  attempt: number;
  now: DateTime;
  signal: AbortSignal;
  executionId: string;
  /**
   * Park this execution again instead of completing it.
   *
   * Records an intent; nothing is written until the handler resolves. Then,
   * in place of the success write, the row goes back to `scheduled` with the
   * new `scheduledAt` and payload, `attempt` reset to 0, the same `id` and
   * `key`, and is dispatched delayed like a push with `delay`. A stage or
   * iteration counter in the payload is what turns a multi-step process into
   * one job switching on `payload.stage`, and a durable loop into a handler
   * that reschedules itself until its limit.
   *
   * - The write is guarded on `running`: a cancel that landed during the
   *   handler wins and the reschedule is dropped.
   * - A handler that throws after calling it takes the retry path on the
   *   OLD payload; the intent is discarded. Called twice, the last call wins.
   * - `payload` is validated against the job schema at call time.
   * - `job:success` is not emitted for a rescheduled run; `job:end` is.
   * - Throws from a cron tick (no row to park) and from an `inline` push
   *   (the caller is waiting for an outcome).
   */
  reschedule: (options: JobRescheduleOptions<T>) => void;
}

export interface JobRescheduleOptions<T extends ZType = ZType> {
  /**
   * Wait this long before the next run. One of `delay` or `scheduledAt` is
   * required.
   */
  delay?: DurationLike;
  /**
   * Run at this instant instead of after `delay`.
   */
  scheduledAt?: Date;
  /**
   * The payload the next run receives. Omitted, the current payload is kept;
   * spread the current one yourself when only a field changes.
   */
  payload?: Infer<T>;
}

export interface JobRetryOptions {
  retries: number;
  when?: (error: Error) => boolean;
  /**
   * The job's own backoff curve, replacing the global `retryBackoffBase`,
   * the doubling and `retryBackoffMax` for this job. Attempt n waits
   * `initial * factor^(n-1)`, capped by `max`, then jittered. See
   * {@link JobRetryBackoff}.
   */
  backoff?: JobRetryBackoff;
}

/**
 * A per-job retry curve.
 *
 * `jitter` defaults to true and means the module's full jitter, uniform in
 * `[0, computed]`: one jitter policy for every job, because spreading a
 * retrying population matters more than the curve itself. `jitter: false`
 * gives the exact curve, which tests want.
 */
export interface JobRetryBackoff {
  initial: DurationLike;
  /**
   * @default 2
   */
  factor?: number;
  /**
   * @default the global `retryBackoffMax` (30 minutes)
   */
  max?: DurationLike;
  /**
   * @default true
   */
  jitter?: boolean;
}

export type JobPriority = "critical" | "high" | "normal" | "low";

export interface JobPrimitiveOptions<
  T extends ZType = ZType,
> extends PipelinePrimitiveOptions {
  /**
   * Optional explicit job name. Defaults to `ClassName.propertyKey`.
   * Recommended convention for framework-internal jobs: `api:module:jobName`.
   */
  name?: string;

  /**
   * Human-readable description (shown in the admin UI).
   */
  description?: string;

  /**
   * Payload schema (Zod). When set, the job is queue-mode.
   * Must not be combined with `cron`.
   */
  schema?: T;

  /**
   * Cron expression for recurring execution. When set, the job is cron-mode.
   * Must not be combined with `schema`.
   */
  cron?: string;

  /**
   * Retry policy for queue-mode and direct-mode jobs. Cron-mode jobs that
   * declare `retry` enqueue a synthetic execution row so failures retry
   * through the outbox sweep; without `retry`, the next tick simply re-runs.
   *
   * Retries are picked up by the reconciliation sweep, so retry granularity
   * is bounded by `sweepCron` (default 15 minutes). The first retry may run
   * earlier than 15 minutes if the sweep tick happens sooner.
   */
  retry?: JobRetryOptions;

  /**
   * **Cron-mode only.** Whether to acquire a distributed lock around the
   * cron tick so that only one instance of a multi-replica deployment runs
   * the handler per tick.
   *
   * Has **no effect** on queue-mode and direct-mode jobs — those rely on
   * the outbox `claim()` UPDATE-guard to serialize work instead, which is
   * always on.
   *
   * To get cross-instance coordination on Docker / Node deployments,
   * register a real `LockProvider` (e.g. `alepha/lock/redis`). The default
   * `MemoryLockProvider` is per-process only.
   *
   * @default true
   */
  lock?: boolean;

  /**
   * Max execution time per attempt. Handler receives an `AbortSignal`.
   */
  timeout?: DurationLike;

  /**
   * Default priority for pushed jobs. Used by the sweep to order
   * dispatch when there is a backlog. Real-time queue consumption
   * is FIFO.
   * @default "normal"
   */
  priority?: JobPriority;

  /**
   * Run the handler inline and make the caller wait for it.
   *
   * ```ts
   * await myJob.push(item, { inline: true });
   * // resolves -> the handler ran to completion, outbox row terminal
   * // rejects  -> the handler failed, row terminal `error`, nothing retries it
   * ```
   *
   * No dispatcher, no `defer()`, no `waitUntil`, no queue. On failure the row
   * is written **terminal `error`, never `scheduled`** - otherwise the sweep
   * would pick it up later and deliver the stale payload anyway, and the flag
   * would buy nothing but a synchronous error stapled to the same broken
   * behaviour.
   *
   * **Use it when the payload is time-limited and a retry in n minutes is not
   * an acceptable outcome.** `verificationSettings.codeExpiration` defaults to
   * 300 s and `jobConfig.sweepCron` to 900 s, so a retried verification code
   * is guaranteed to arrive after it expired: all three attempts produce
   * garbage while the user sees nothing. Failing in front of the user lets
   * them retry the flow themselves.
   *
   * **"Ran to completion" means the handler resolved.** For an email that is
   * the provider accepting the message, not delivery to an inbox. Do not read
   * it as more than that.
   *
   * **Call it after the commit, not inside a transaction.** An email cannot be
   * rolled back, so sending inside a transaction that later fails means
   * mailing a code for a row that no longer exists. `inline` buys ordering
   * (the caller learns before it commits), not transactionality.
   *
   * Declared here it is the job's default; {@link PushOptions.inline} overrides
   * it per call, which is the form most callers want - see there for why.
   *
   * Rejected at registration alongside `cron` (a tick has no caller to block)
   * or alongside `retry` (declaring "retry three times" and "tell the caller
   * now" as one default is a contradiction; a *per-push* `inline` on a job
   * that declares `retry` is coherent and means "not this execution").
   *
   * Not to be confused with `$notification`'s `critical`, which is a different
   * property one layer up: that one means the recipient cannot opt out (no
   * unsubscribe link, passes the suppression gate). `inline` names the
   * mechanism, which is what `JobProvider.executeInline()` already calls it.
   *
   * @default false
   */
  inline?: boolean;

  /**
   * Whether to record successful executions.
   *
   * - `"error"` (default for queue): only error/cancelled rows kept
   * - `"all"`: keep success rows too (bounded by `keepLastSuccess`)
   * - `"none"`: fire-and-forget, no row even on error
   *
   * **Cron jobs default to keeping their last successful run** (`record: "all"`
   * with `keep.ok = 1`) so the admin "Last run" is accurate — set
   * `record: "error"` to opt out (e.g. for very high-frequency crons).
   *
   * Note: queue-mode jobs always write a `pending` row at push time (outbox).
   * This setting controls whether that row is kept on success.
   */
  record?: "error" | "all" | "none";

  /**
   * Override the global ring-buffer trim for this job.
   *
   * - `{ ok: 0, error: 0 }` — **keep forever** (no sweep trim). Useful for
   *   audit-heavy jobs where retention is time-based (handled by a separate
   *   cron) rather than count-based.
   * - `{ ok: 50 }` — keep last 50 successes; fall back to global default for errors.
   * - omitted — use global `keepLastSuccess` / `keepLastError` from `jobConfig`.
   */
  keep?: {
    ok?: number;
    error?: number;
  };

  /**
   * Handler function. For cron-mode, `payload` is `undefined`.
   */
  handler: (args: JobHandlerArgs<T>) => Async<void>;
}

// -----------------------------------------------------------------------------------------------------------------

export class JobPrimitive<T extends ZType = ZType> extends PipelinePrimitive<
  JobPrimitiveOptions<T>
> {
  protected readonly jobProvider = $inject(JobProvider);

  public get name(): string {
    return (
      this.options.name ??
      `${this.config.service.name}.${this.config.propertyKey}`
    );
  }

  protected onInit() {
    const handler = this.handler.run.bind(this.handler);
    this.jobProvider.registerJob(this.name, { ...this.options, handler });
  }

  /**
   * Push a single payload to the queue (queue-mode only).
   */
  public async push(payload: Infer<T>, options?: PushOptions): Promise<string> {
    return this.jobProvider.push(this.name, payload, options);
  }

  /**
   * Push multiple payloads at once (queue-mode only).
   * Batched INSERT + batched queue send when supported.
   */
  public async pushMany(items: Array<PushManyItem<T>>): Promise<string[]> {
    return this.jobProvider.pushMany(this.name, items);
  }

  /**
   * Cancel a pending, scheduled or running execution.
   */
  public async cancel(
    executionId: string,
    context?: CancelContext,
  ): Promise<void> {
    return this.jobProvider.cancel(executionId, context);
  }

  /**
   * Cancel the execution parked under `key`, if there is one.
   *
   * Only a `pending` or `scheduled` row is cancelled; a `running` one is left
   * to finish and `null` comes back. A listener reacting to an event cannot
   * know whether that event is the running handler's own doing (a
   * reconciliation stage that settles a checkout emits the very event that
   * would cancel it), so the handler's own re-check at its next stage is the
   * right place for that decision. The admin's {@link cancel} still aborts a
   * running row.
   *
   * Returns the cancelled execution id, or `null` when nothing was parked
   * under that key.
   */
  public async cancelByKey(
    key: string,
    context?: CancelContext,
  ): Promise<string | null> {
    return this.jobProvider.cancelByKey(this.name, key, context);
  }

  /**
   * Manually fire a cron-mode job, or trigger a queue-mode job with an explicit payload.
   */
  public async trigger(context?: JobTriggerContext<T>): Promise<void> {
    return this.jobProvider.trigger(this.name, context);
  }
}

$job[KIND] = JobPrimitive;
