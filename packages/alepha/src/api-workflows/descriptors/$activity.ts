import { KIND } from "../../core/constants/KIND.ts";
import type { Static, TObject } from "../../core/providers/TypeProvider.ts";
import type { Duration, RetryPolicy } from "./$workflow.ts";

/**
 * Define a workflow activity that encapsulates side effects.
 *
 * Activities are the unit of work that:
 * - Execute side effects (API calls, database writes, file operations)
 * - Can be retried on failure
 * - Have their own timeout and heartbeat configuration
 * - Are idempotent (safe to execute multiple times)
 *
 * @example
 * ```typescript
 * class OrderActivities {
 *   paymentGateway = $inject(PaymentGateway);
 *
 *   chargePayment = $activity({
 *     name: "charge-payment",
 *     schema: t.object({
 *       orderId: t.uuid(),
 *       customerId: t.uuid(),
 *       amount: t.number(),
 *     }),
 *     timeout: { seconds: 30 },
 *     retryPolicy: {
 *       maxAttempts: 3,
 *       backoff: "exponential",
 *     },
 *     handler: async ({ orderId, customerId, amount }, ctx) => {
 *       const payment = await this.paymentGateway.charge({
 *         customer: customerId,
 *         amount,
 *         metadata: { orderId },
 *       });
 *       await ctx.heartbeat();
 *       return { id: payment.id, confirmationId: payment.confirmation };
 *     },
 *   });
 * }
 * ```
 */
export const $activity = <T extends TObject, TOutput = any>(
  options: ActivityOptions<T, TOutput>,
): Activity<T, TOutput> => {
  return new Activity<T, TOutput>(options);
};

export interface ActivityOptions<T extends TObject, TOutput = any> {
  /** Unique activity identifier */
  name: string;
  /** Input schema validation */
  schema: T;
  /** Activity handler function */
  handler: ActivityHandler<T, TOutput>;
  /** Maximum activity execution time */
  timeout?: Duration;
  /** Retry policy for activity failures */
  retryPolicy?: RetryPolicy;
  /** Heartbeat interval for long-running activities */
  heartbeat?: Duration;
  /** Description for documentation */
  description?: string;
}

export type ActivityHandler<T extends TObject, TOutput = any> = (
  input: Static<T>,
  ctx: ActivityContext,
) => Promise<TOutput>;

export interface ActivityContext {
  /** Unique activity execution ID */
  activityId: string;
  /** Parent workflow ID */
  workflowId: string;
  /** Current retry attempt (1-based) */
  attempt: number;
  /** Send heartbeat to prevent timeout */
  heartbeat(): Promise<void>;
  /** Check if workflow was canceled */
  isCanceled(): boolean;
}

export class Activity<T extends TObject = TObject, TOutput = any> {
  public readonly options: ActivityOptions<T, TOutput>;

  constructor(options: ActivityOptions<T, TOutput>) {
    this.options = options;
  }

  get name(): string {
    return this.options.name;
  }

  get schema(): T {
    return this.options.schema;
  }

  get handler(): ActivityHandler<T, TOutput> {
    return this.options.handler;
  }

  get timeout(): Duration | undefined {
    return this.options.timeout;
  }

  get retryPolicy(): RetryPolicy | undefined {
    return this.options.retryPolicy;
  }

  get heartbeat(): Duration | undefined {
    return this.options.heartbeat;
  }
}

$activity[KIND] = "activity";
