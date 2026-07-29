import {
  $inject,
  type Async,
  createPrimitive,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
  type Static,
  type TSchema,
} from "alepha";
import type { DateTime, DurationLike } from "alepha/datetime";
import {
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
export const $job = <T extends TSchema = TSchema>(
  options: JobPrimitiveOptions<T>,
): JobPrimitive<T> => {
  return createPrimitive(JobPrimitive<T>, options);
};

// -----------------------------------------------------------------------------------------------------------------

export interface JobHandlerArgs<T extends TSchema = TSchema> {
  payload: Static<T>;
  attempt: number;
  now: DateTime;
  signal: AbortSignal;
  executionId: string;
}

export interface JobRetryOptions {
  retries: number;
  when?: (error: Error) => boolean;
}

export type JobPriority = "critical" | "high" | "normal" | "low";

export interface JobPrimitiveOptions<T extends TSchema = TSchema>
  extends PipelinePrimitiveOptions {
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

export class JobPrimitive<
  T extends TSchema = TSchema,
> extends PipelinePrimitive<JobPrimitiveOptions<T>> {
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
  public async push(
    payload: Static<T>,
    options?: PushOptions,
  ): Promise<string> {
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
   * Cancel a pending or running execution.
   */
  public async cancel(executionId: string): Promise<void> {
    return this.jobProvider.cancel(executionId);
  }

  /**
   * Manually fire a cron-mode job, or trigger a queue-mode job with an explicit payload.
   */
  public async trigger(context?: JobTriggerContext<T>): Promise<void> {
    return this.jobProvider.trigger(this.name, context);
  }
}

$job[KIND] = JobPrimitive;
