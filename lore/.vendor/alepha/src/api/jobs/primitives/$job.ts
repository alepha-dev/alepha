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

/**
 * How long one status of a job's executions is kept. See
 * {@link JobPrimitiveOptions.retention}.
 */
export interface JobRetentionRule {
  /**
   * Keep the newest `last` rows. An integer of at least 1.
   */
  last?: number;

  /**
   * Keep rows that completed within this many days. Positive. A function is
   * read at every trim tick and whenever the admin reads the job, for a window
   * held in a runtime-editable parameter.
   */
  days?: number | (() => number);
}

/**
 * A job's retention, per status. `cancelled` follows `error`. `false` means
 * the status is not recorded. See {@link JobPrimitiveOptions.retention}.
 */
export interface JobRetentionOptions {
  ok?: JobRetentionRule | false;
  error?: JobRetentionRule | false;
}

export interface JobPrimitiveOptions<
  T extends ZType = ZType,
> extends PipelinePrimitiveOptions {
  /**
   * The job's name: `<domain>.<action>`, lowercase kebab-case segments, such
   * as `estates.sweep-commands` or `quests.send-due-reminders`. The domain is
   * the module or business area, a plural noun where natural, and the action
   * does not repeat it. Everything shipped from `packages/` (alepha and every
   * `@alepha/*`) is `system.<domain>.<action>`, so a framework job never
   * collides with an application's; an application never uses `system.`.
   *
   * Checked at registration against
   * `^(system\.)?[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$`.
   *
   * The name is the job's identity in `job_executions`. **Renaming a job
   * loses its rows**: history, and any queued or scheduled work under the
   * old name, are deleted at the next trim tick.
   */
  name: string;

  /**
   * What the job does, in one sentence, shown to operators in the admin.
   * Present tense, what it does and on what: "Deletes sessions past their
   * expiry date.". Not empty, at most 255 characters.
   *
   * Like the name, it is developer text and is not translated.
   */
  description: string;

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
   * How long the job's executions are kept, per status.
   *
   * ```ts
   * $job({
   *   name: "quests.send-due-reminders",
   *   description: "Sends the quest reminders that are due.",
   *   cron: "0 0 * * *",
   *   retention: {
   *     ok: { last: 7 },     // the last 7 successes
   *     error: { days: 30 }, // 30 days of failures
   *   },
   * });
   * ```
   *
   * `ok` is the rule for successes, `error` the rule for failures, and
   * cancelled rows follow `error`. Each takes `{ last?, days? }` or `false`:
   *
   * - `last` keeps the newest `last` rows, an integer of at least 1.
   * - `days` keeps rows that completed within that many days, a positive
   *   number, or a function read at every trim tick, for a window an
   *   operator edits at runtime.
   * - Both set: a row goes when it breaks **either** limit.
   * - `false`: the status is not recorded. No row is written, a queue job's
   *   outbox row is deleted when it ends that way, and the trim deletes any
   *   row of that status left from before.
   *
   * A rule with neither `last` nor `days` is refused at registration: there
   * is no "forever".
   *
   * A status the job does not declare takes the framework's default, decided
   * by how often the job runs. For a cron, the cadence is the shortest gap
   * among its next 10 fire dates:
   *
   * | Job                             | Successes      | Failures |
   * | ------------------------------- | -------------- | -------- |
   * | cron, at least every 15 minutes | last 12        | 30 days  |
   * | cron, up to hourly              | last 24        | 30 days  |
   * | cron, up to daily               | last 7         | 30 days  |
   * | cron, slower                    | last 5         | 30 days  |
   * | queue                           | not recorded   | 30 days  |
   *
   * The failure window is `jobConfig.retention.errorDays`, and a default rule
   * is also capped at `jobConfig.retention.maxRows` rows. A declared rule is
   * never capped: it is the author's statement.
   *
   * For a cron, the newest row of each status survives its window, so a
   * monthly job never looks like it never ran. A queue job keeps no such
   * row: no row in 30 days means it did not run in 30 days.
   *
   * A kept run keeps its captured logs (up to `jobConfig.logMaxEntries`
   * entries), whatever its outcome.
   */
  retention?: JobRetentionOptions;

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
    return this.options.name;
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
   *
   * A cron-mode trigger never overlaps a run of the same job already in
   * progress, scheduled or triggered: in this process, or on another replica
   * while `lock` is on. It returns without running instead, and resolves
   * either way, so resolving does not mean the handler ran.
   */
  public async trigger(context?: JobTriggerContext<T>): Promise<void> {
    return this.jobProvider.trigger(this.name, context);
  }
}

$job[KIND] = JobPrimitive;
