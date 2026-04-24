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

export interface JobRetryBackoff {
  initial: DurationLike;
  factor?: number;
  max?: DurationLike;
  jitter?: boolean;
}

export interface JobRetryOptions {
  retries: number;
  backoff?: DurationLike | JobRetryBackoff;
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
   * Payload schema (TypeBox). When set, the job is queue-mode.
   * Must not be combined with `cron`.
   */
  schema?: T;

  /**
   * Cron expression for recurring execution. When set, the job is cron-mode.
   * Must not be combined with `schema`.
   */
  cron?: string;

  /**
   * Retry policy for queue-mode jobs.
   * Cron-mode jobs do not retry — the next tick re-runs.
   */
  retry?: JobRetryOptions;

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
   * - `"error"` (default for cron, default for queue): only error/cancelled rows kept
   * - `"all"`: keep success rows too (bounded by `keepLastSuccess`)
   * - `"none"`: fire-and-forget, no row even on error
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
