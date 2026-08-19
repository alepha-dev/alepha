import {
  $inject,
  type Atom,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZType,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import { WorkflowProvider } from "../providers/WorkflowProvider.ts";

// -----------------------------------------------------------------------------------------------------------------

export type WorkflowPriority = "critical" | "high" | "normal" | "low";

export interface WorkflowRetryOptions {
  retries: number;
  backoff?: DurationLike | WorkflowRetryBackoff;
  when?: (error: Error) => boolean;
}

export interface WorkflowRetryBackoff {
  initial: DurationLike;
  factor?: number;
  max?: DurationLike;
  jitter?: boolean;
}

export interface WorkflowRepeatOptions {
  /**
   * Durable wait between iterations, persisted like any other wait — a
   * crash between iterations is resumed by the recovery sweep.
   */
  delay: DurationLike;

  /**
   * Maximum total number of runs of the step. When the handler still asks
   * to repeat after the limit-th run, the step fails and normal `onError`
   * semantics apply. Unlimited when omitted.
   */
  limit?: number;
}

// -----------------------------------------------------------------------------------------------------------------

export interface StepHandlerArgs<TInput extends ZType = ZType> {
  payload: Infer<TInput>;
  results: Record<string, unknown>;
  context: {
    workflowId: string;
    executionId: string;
    stepName: string;
    attempt: number;

    /**
     * Zero-based run counter for repeating steps (`repeat` option) —
     * "which round is this". Always 0 for non-repeating steps.
     */
    iteration: number;
  };
  signal: AbortSignal;
}

export interface StepCompensateArgs<TInput extends ZType = ZType> {
  payload: Infer<TInput>;
  result: unknown;
  results: Record<string, unknown>;
  context: {
    workflowId: string;
    executionId: string;
    stepName: string;
    error: Error;
  };
}

export interface StepConditionArgs<TInput extends ZType = ZType> {
  payload: Infer<TInput>;
  results: Record<string, unknown>;
}

// -----------------------------------------------------------------------------------------------------------------

export interface WorkflowStep<TInput extends ZType = ZType> {
  name: string;
  handler: (args: StepHandlerArgs<TInput>) => Promise<unknown>;
  compensate?: (args: StepCompensateArgs<TInput>) => Promise<void>;
  retry?: WorkflowRetryOptions;
  timeout?: DurationLike;
  when?: (args: StepConditionArgs<TInput>) => boolean | Promise<boolean>;

  /**
   * Durable wait before this step runs, counted from the moment the
   * previous step completed. Survives restarts: the wait is persisted as
   * the step's `scheduledAt` and delivered by the job outbox — a local
   * timer only optimizes latency. Use for sequences like "send reminder
   * after 24h".
   */
  delay?: DurationLike;

  /**
   * Make this step durably repeatable: when its handler resolves with
   * `{ repeat: true, ... }`, the SAME step is re-parked and runs again
   * after `delay` — the wait is persisted, so iterations survive crashes
   * and are resumed by the recovery sweep. Any other resolution is the
   * step's final result and falls through to the next step.
   *
   * The retry budget resets each iteration, and iteration handlers must
   * be idempotent — a crash between the verdict and the re-park replays
   * the same iteration. Use for offer/claim loops: "offer the slot to
   * the next candidate, check back in 10 minutes".
   */
  repeat?: WorkflowRepeatOptions;
}

// -----------------------------------------------------------------------------------------------------------------

export interface WorkflowPrimitiveOptions<TInput extends ZType = ZType> {
  /**
   * Zod schema for the workflow input payload.
   */
  schema: TInput;

  /**
   * Ordered list of steps. Executed sequentially.
   */
  steps: Array<WorkflowStep<TInput>>;

  /**
   * Error strategy.
   * - "compensate": Run compensate functions in reverse order (saga pattern).
   * - "fail": Mark workflow as failed, no compensation.
   * @default "compensate"
   */
  onError?: "compensate" | "fail";

  /**
   * Maximum total duration for the entire workflow.
   */
  timeout?: DurationLike;

  /**
   * Priority for the workflow's job dispatches.
   * @default "normal"
   */
  priority?: WorkflowPriority;

  /**
   * Tags for filtering/grouping in admin UI.
   */
  tags?: string[];

  /**
   * Atoms whose current values are captured when an execution starts and
   * restored around every step, `when()` and compensation handler - on
   * whatever process ends up running them, including recovery-sweep
   * dispatches after a crash. The canonical use is tenancy:
   * `context: [currentTenantAtom]` makes each step run under the tenant
   * that started the workflow, without hand-carrying an id through the
   * payload. Values are persisted with the execution, so they must
   * survive a JSON round-trip.
   */
  context?: Array<Atom<any>>;
}

// -----------------------------------------------------------------------------------------------------------------

export interface WorkflowStartOptions {
  key?: string;
  priority?: WorkflowPriority;
  delay?: DurationLike;
  triggeredBy?: string;
  triggeredByName?: string;
  tags?: string[];
}

// -----------------------------------------------------------------------------------------------------------------

export class WorkflowPrimitive<TInput extends ZType = ZType> extends Primitive<
  WorkflowPrimitiveOptions<TInput>
> {
  protected readonly workflowProvider = $inject(WorkflowProvider);

  public get name(): string {
    return `${this.config.service.name}.${this.config.propertyKey}`;
  }

  protected onInit() {
    this.workflowProvider.register(this);
  }

  /**
   * Start a new workflow execution.
   */
  public async start(
    payload: Infer<TInput>,
    options?: WorkflowStartOptions,
  ): Promise<string> {
    return this.workflowProvider.start(this.name, payload, options);
  }

  /**
   * Cancel a running execution.
   */
  public async cancel(
    executionId: string,
    options?: { compensate?: boolean },
  ): Promise<void> {
    return this.workflowProvider.cancel(executionId, {
      compensate: options?.compensate,
    });
  }

  /**
   * Start one execution per item — per-item fan-out. Each child gets its
   * own dedup key, retry budget, logs and admin row; the trade against a
   * single step looping over all items is more rows in exchange for
   * per-item granularity. Keys make the fan-out re-drivable: items whose
   * key is already live dedup to the existing execution, so calling this
   * again after a partial failure only starts what is missing.
   */
  public async startEach<T>(
    items: readonly T[],
    map: (
      item: T,
      index: number,
    ) => { payload: Infer<TInput> } & WorkflowStartOptions,
  ): Promise<string[]> {
    return Promise.all(
      items.map((item, index) => {
        const { payload, ...options } = map(item, index);
        return this.start(payload, options);
      }),
    );
  }

  /**
   * Cancel the live execution armed under a dedup key, if any.
   * No-op (returns null) when nothing is live under the key.
   */
  public async cancelByKey(
    key: string,
    options?: { compensate?: boolean; cancelledByName?: string },
  ): Promise<string | null> {
    return this.workflowProvider.cancelByKey(this.name, key, {
      compensate: options?.compensate,
      cancelledByName: options?.cancelledByName,
    });
  }

  /**
   * Retry a failed/timed-out execution from the failed step.
   */
  public async retry(executionId: string): Promise<void> {
    return this.workflowProvider.retry(executionId);
  }

  /**
   * Restart a terminal execution from the beginning (new execution).
   */
  public async restart(executionId: string): Promise<string> {
    return this.workflowProvider.restart(executionId);
  }

  /**
   * Get the status of an execution.
   */
  public async status(executionId: string) {
    return this.workflowProvider.getExecution(executionId);
  }
}

// -----------------------------------------------------------------------------------------------------------------

/**
 * Declare a durable, multi-step workflow (saga).
 *
 * Steps run sequentially; each step's result is persisted and passed to
 * later steps via `results`. On failure, completed steps are compensated
 * in reverse order (`onError: "compensate"`, the default) or the
 * execution is marked failed (`onError: "fail"`).
 */
export const $workflow = <TInput extends ZType>(
  options: WorkflowPrimitiveOptions<TInput>,
) => {
  return createPrimitive(WorkflowPrimitive<TInput>, options);
};

$workflow[KIND] = WorkflowPrimitive;
