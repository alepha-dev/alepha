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
 * Job primitive for defining scheduled and on-demand tasks with payload validation, retry policies, and batching.
 */
export const $job = <T extends TSchema = TSchema>(
  options: JobPrimitiveOptions<T>,
): JobPrimitive<T> => {
  return createPrimitive(JobPrimitive<T>, options);
};

// -----------------------------------------------------------------------------------------------------------------

export interface JobItem<T extends TSchema = TSchema> {
  id: string;
  payload: Static<T>;
  attempt: number;
}

export interface JobHandlerArgs<T extends TSchema = TSchema> {
  items: Array<JobItem<T>>;
  now: DateTime;
  signal: AbortSignal;
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

export interface JobBatchOptions {
  size: number;
  window: DurationLike;
}

export type JobPriority = "critical" | "high" | "normal" | "low";

export interface JobPrimitiveOptions<T extends TSchema = TSchema>
  extends PipelinePrimitiveOptions {
  /**
   * Payload schema (TypeBox). Optional for cron-only jobs.
   */
  schema?: T;

  /**
   * Cron expression for automatic scheduling.
   */
  cron?: string;

  /**
   * Whether to use a distributed lock for cron execution.
   * @default true
   */
  lock?: boolean;

  /**
   * Retry policy for failed executions.
   */
  retry?: JobRetryOptions;

  /**
   * Max execution time per attempt.
   */
  timeout?: DurationLike;

  /**
   * Max parallel executions.
   * @default 1
   */
  concurrency?: number;

  /**
   * Consumer batching configuration.
   */
  batch?: JobBatchOptions;

  /**
   * Default priority for pushed jobs.
   * @default "normal"
   */
  priority?: JobPriority;

  /**
   * Handler function for job execution.
   */
  handler: (args: JobHandlerArgs<T>) => Async<void>;
}

// -----------------------------------------------------------------------------------------------------------------

export class JobPrimitive<
  T extends TSchema = TSchema,
> extends PipelinePrimitive<JobPrimitiveOptions<T>> {
  protected readonly jobProvider = $inject(JobProvider);

  public get name(): string {
    return `${this.config.service.name}.${this.config.propertyKey}`;
  }

  protected onInit() {
    const handler = this.handler.run.bind(this.handler);
    this.jobProvider.registerJob(this.name, { ...this.options, handler });
  }

  /**
   * Push a single payload or an array of payloads.
   */
  public async push(
    payload: Static<T> | Array<Static<T>>,
    options?: PushOptions,
  ): Promise<string | string[]> {
    if (Array.isArray(payload)) {
      const ids = await Promise.all(
        payload.map((p) => this.jobProvider.push(this.name, p, options)),
      );
      return ids;
    }
    return this.jobProvider.push(this.name, payload, options);
  }

  /**
   * Push multiple payloads with per-item options.
   */
  public async pushMany(items: Array<PushManyItem<T>>): Promise<string[]> {
    return this.jobProvider.pushMany(this.name, items);
  }

  /**
   * Cancel a running or pending execution.
   */
  public async cancel(executionId: string): Promise<void> {
    return this.jobProvider.cancel(executionId);
  }

  /**
   * Manually trigger the job (admin / CLI).
   */
  public async trigger(context?: JobTriggerContext): Promise<void> {
    return this.jobProvider.trigger(this.name, context);
  }
}

$job[KIND] = JobPrimitive;
