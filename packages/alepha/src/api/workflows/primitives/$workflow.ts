import {
  $inject,
  createPrimitive,
  KIND,
  Primitive,
  type Static,
  type TSchema,
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

// -----------------------------------------------------------------------------------------------------------------

export interface StepHandlerArgs<TInput extends TSchema = TSchema> {
  payload: Static<TInput>;
  results: Record<string, unknown>;
  context: {
    workflowId: string;
    executionId: string;
    stepName: string;
    attempt: number;
  };
  signal: AbortSignal;
}

export interface StepCompensateArgs<TInput extends TSchema = TSchema> {
  payload: Static<TInput>;
  result: unknown;
  results: Record<string, unknown>;
  context: {
    workflowId: string;
    executionId: string;
    stepName: string;
    error: Error;
  };
}

export interface StepConditionArgs<TInput extends TSchema = TSchema> {
  payload: Static<TInput>;
  results: Record<string, unknown>;
}

// -----------------------------------------------------------------------------------------------------------------

export interface HandlerStep<TInput extends TSchema = TSchema> {
  name: string;
  type?: "handler";
  handler: (args: StepHandlerArgs<TInput>) => Promise<unknown>;
  compensate?: (args: StepCompensateArgs<TInput>) => Promise<void>;
  retry?: WorkflowRetryOptions;
  timeout?: DurationLike;
  when?: (args: StepConditionArgs<TInput>) => boolean | Promise<boolean>;
}

export type WorkflowStep<TInput extends TSchema = TSchema> =
  HandlerStep<TInput>;

// -----------------------------------------------------------------------------------------------------------------

export interface WorkflowPrimitiveOptions<TInput extends TSchema = TSchema> {
  /**
   * TypeBox schema for the workflow input payload.
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

export class WorkflowPrimitive<
  TInput extends TSchema = TSchema,
> extends Primitive<WorkflowPrimitiveOptions<TInput>> {
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
    payload: Static<TInput>,
    options?: WorkflowStartOptions,
  ): Promise<string> {
    return this.workflowProvider.start(this.name, payload, options);
  }

  /**
   * Send a signal to a waiting step on a specific execution.
   */
  public async signal(
    executionId: string,
    stepName: string,
    payload?: unknown,
  ): Promise<void> {
    return this.workflowProvider.signal(executionId, stepName, payload);
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

export const $workflow = <TInput extends TSchema>(
  options: WorkflowPrimitiveOptions<TInput>,
) => {
  return createPrimitive(WorkflowPrimitive<TInput>, options);
};

$workflow[KIND] = WorkflowPrimitive;
