import { $inject, AlephaError } from "alepha";
import { $repository } from "alepha/orm";

import { workflowExecutions } from "../entities/workflowExecutions.ts";
import { workflowStepExecutions } from "../entities/workflowStepExecutions.ts";
import { WorkflowProvider } from "../providers/WorkflowProvider.ts";

export interface WorkflowTestKitPollOptions {
  /**
   * Maximum number of poll attempts before giving up.
   * @default 200
   */
  attempts?: number;

  /**
   * Wall-clock pause between attempts, in milliseconds.
   * @default 50
   */
  intervalMs?: number;

  /**
   * Label used in the timeout error, so a red test says WHAT it was
   * waiting for.
   */
  label?: string;
}

/**
 * Test helpers for workflow specs, encoding the two disciplines every
 * dogfood app was copy-pasting:
 *
 * 1. **Park before travel.** A `travel()` only releases timers that exist,
 *    and a step's wait exists once its row is pending WITH a `scheduledAt`
 *    stamp — {@link awaitParked} waits for exactly that.
 * 2. **Nudge after travel.** Post-travel the clock is frozen and no cron
 *    ever ticks again, so lost wake-ups must be re-derived from the DB the
 *    way production's next sweep tick would — {@link settle} runs the
 *    recovery sweep before every poll.
 *
 * Poll budgets are attempt-counted rather than deadline-based on purpose:
 * a deadline read from a travel-frozen `DateTimeProvider` would never
 * advance — `attempts × intervalMs` bounds the wait without consulting
 * any clock.
 *
 * Usable from any app: `alepha.inject(WorkflowTestKit)`.
 */
export class WorkflowTestKit {
  protected readonly executions = $repository(workflowExecutions);
  protected readonly steps = $repository(workflowStepExecutions);
  protected readonly provider = $inject(WorkflowProvider);

  /**
   * Find the first execution of `workflowName` whose payload contains
   * every entry of `match`. Payload lookup is the stable handle: dedup
   * keys stay on terminal rows nowadays, but payload matching also works
   * for unkeyed workflows and across re-runs.
   */
  public async findByPayload(
    workflowName: string,
    match: Record<string, unknown>,
  ) {
    const rows = await this.executions.findMany({
      where: { workflowName: { eq: workflowName } },
    });
    return rows.find((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return Object.entries(match).every(([k, v]) => payload[k] === v);
    });
  }

  /**
   * Poll until an execution matching `workflowName` + `match` exists.
   */
  public async awaitExecution(
    workflowName: string,
    match: Record<string, unknown>,
    options?: WorkflowTestKitPollOptions,
  ) {
    return this.poll(
      () => this.findByPayload(workflowName, match),
      (row) => Boolean(row),
      options?.label ?? `execution of '${workflowName}'`,
      options,
    );
  }

  /**
   * Poll until `stepName` is parked: pending with a `scheduledAt` stamp.
   * Call this BEFORE every `travel()` — travelling earlier races the
   * stamp write, and the released timer may not exist yet.
   */
  public async awaitParked(
    executionId: string,
    stepName: string,
    options?: WorkflowTestKitPollOptions,
  ) {
    return this.poll(
      () =>
        this.steps.findOne({
          where: {
            workflowExecutionId: { eq: executionId },
            stepName: { eq: stepName },
          },
        }),
      (step) => step?.status === "pending" && Boolean(step?.scheduledAt),
      options?.label ?? `step '${stepName}' parked`,
      options,
    );
  }

  /**
   * Poll until the execution reaches `status`, nudging the recovery sweep
   * before each attempt. Use after `travel()`.
   */
  public async awaitStatus(
    executionId: string,
    status:
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "timed_out"
      | "compensating"
      | "compensated"
      | "compensation_failed"
      | "cancelled",
    options?: WorkflowTestKitPollOptions,
  ) {
    return this.settle(
      () => this.executions.findById(executionId),
      (row) => row?.status === status,
      { label: `execution ${executionId} → ${status}`, ...options },
    );
  }

  /**
   * Poll `fn` until `predicate` accepts its value, running the recovery
   * sweep (idempotent) before every attempt — the test-time stand-in for
   * production's next cron tick on a travel-frozen clock.
   */
  public async settle<T>(
    fn: () => Promise<T> | T,
    predicate: (value: T) => boolean,
    options?: WorkflowTestKitPollOptions,
  ): Promise<NonNullable<T>> {
    return this.poll(
      async () => {
        await this.provider.recoverySweep();
        return fn();
      },
      predicate,
      options?.label ?? "workflow settled",
      options,
    );
  }

  protected async poll<T>(
    fn: () => Promise<T> | T,
    predicate: (value: T) => boolean,
    label: string,
    options?: WorkflowTestKitPollOptions,
  ): Promise<NonNullable<T>> {
    const attempts = options?.attempts ?? 200;
    const intervalMs = options?.intervalMs ?? 50;

    let last: T = await fn();
    for (let i = 0; i < attempts; i++) {
      if (predicate(last)) {
        return last as NonNullable<T>;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      last = await fn();
    }
    if (predicate(last)) {
      return last as NonNullable<T>;
    }
    throw new AlephaError(
      `WorkflowTestKit: '${label}' not reached after ${attempts} polls ` +
        `(${attempts * intervalMs}ms); last value: ${JSON.stringify(last)}`,
    );
  }
}
