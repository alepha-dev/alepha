import { KIND } from "../../core/constants/KIND.ts";
import type { Static, TObject } from "../../core/providers/TypeProvider.ts";

/**
 * Define a durable workflow that orchestrates activities and manages state across failures.
 *
 * Workflows are deterministic orchestrations that:
 * - Survive process restarts and failures
 * - Maintain state through event sourcing
 * - Support compensation/rollback (saga pattern)
 * - Can run for days, weeks, or months
 * - Handle human-in-the-loop operations
 *
 * @example
 * ```typescript
 * class OrderWorkflows {
 *   activities = $inject(OrderActivities);
 *
 *   fulfillment = $workflow({
 *     name: "order-fulfillment",
 *     schema: t.object({
 *       orderId: t.uuid(),
 *       customerId: t.uuid(),
 *     }),
 *     handler: async ({ orderId, customerId }, ctx) => {
 *       const reservation = await ctx.activity(this.activities.reserveInventory, { orderId });
 *       const payment = await ctx.activity(this.activities.chargePayment, { orderId, customerId });
 *       await ctx.activity(this.activities.shipOrder, { orderId });
 *       return { status: "fulfilled", paymentId: payment.id };
 *     },
 *   });
 * }
 * ```
 */
export const $workflow = <T extends TObject, TOutput = any>(
  options: WorkflowOptions<T, TOutput>,
): Workflow<T, TOutput> => {
  return new Workflow<T, TOutput>(options);
};

export interface WorkflowOptions<T extends TObject, TOutput = any> {
  /** Unique workflow identifier */
  name: string;
  /** Workflow version for schema evolution */
  version?: string;
  /** Input schema validation */
  schema: T;
  /** Workflow handler function */
  handler: WorkflowHandler<T, TOutput>;
  /** Maximum workflow execution time */
  timeout?: Duration;
  /** Retry policy for workflow failures */
  retryPolicy?: RetryPolicy;
  /** Description for documentation */
  description?: string;
}

export type WorkflowHandler<T extends TObject, TOutput = any> = (
  input: Static<T>,
  ctx: WorkflowContext<Static<T>>,
) => Promise<TOutput>;

export interface WorkflowContext<TInput> {
  // Workflow metadata
  workflowId: string;
  runId: string;
  input: TInput;

  // Execute activities (side effects)
  activity<TActivityInput, TActivityOutput>(
    activity: any, // Activity instance
    input: TActivityInput,
  ): Promise<TActivityOutput>;

  // Timing
  timer(duration: Duration): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): Date; // Deterministic time

  // Control flow
  parallel<T>(fn: () => Promise<T>[]): Promise<T[]>;
  race<T>(fn: () => Promise<T>[]): Promise<T>;

  // Child workflows
  child<TChildInput, TChildOutput>(
    workflow: any, // Workflow instance
    input: TChildInput,
  ): Promise<TChildOutput>;

  // Saga pattern
  compensate(handler: () => Promise<void>): void;

  // Signals (external events)
  waitForSignal<T>(signal: any): Promise<T>;
  sendSignal<T>(workflowId: string, signal: any, payload: T): Promise<void>;

  // Human tasks
  humanTask<T>(taskType: string, data: any): Promise<T>;

  // State
  state: Record<string, any>;
  memo<T>(key: string, fn: () => Promise<T>): Promise<T>;

  // Deterministic utilities
  random(): number;
  uuid(): string;
}

export interface Duration {
  milliseconds?: number;
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
}

export interface RetryPolicy {
  maxAttempts?: number;
  backoff?: "exponential" | "linear" | "fixed";
  initialInterval?: Duration;
  maxInterval?: Duration;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
}

export class Workflow<T extends TObject = TObject, TOutput = any> {
  public readonly options: WorkflowOptions<T, TOutput>;

  constructor(options: WorkflowOptions<T, TOutput>) {
    this.options = options;
  }

  get name(): string {
    return this.options.name;
  }

  get version(): string {
    return this.options.version ?? "1";
  }

  get schema(): T {
    return this.options.schema;
  }

  get handler(): WorkflowHandler<T, TOutput> {
    return this.options.handler;
  }
}

$workflow[KIND] = "workflow";
