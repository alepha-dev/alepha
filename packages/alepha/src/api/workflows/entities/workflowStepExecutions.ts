import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { workflowExecutions } from "./workflowExecutions.ts";

/**
 * Step execution record — one row per declared step, created at start time.
 *
 * Status transitions:
 * - start (all steps)      → pending
 * - dispatch claims step   → running
 * - handler returns        → completed
 * - handler throws, retry  → pending (with deadlineAt = next attempt)
 * - retries exhausted      → failed
 * - `when()` returns false → skipped
 * - saga rollback          → compensating → compensated (or compensation_failed)
 * - cancel()               → cancelled
 */
export const workflowStepExecutions = $entity({
  name: "workflow_step_executions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    workflowExecutionId: db.ref(z.uuid(), () => workflowExecutions.cols.id, {
      onDelete: "cascade",
    }),

    stepName: z.text(),
    stepIndex: z.integer(),

    status: db.default(
      z.enum([
        "pending",
        "running",
        "completed",
        "failed",
        "skipped",
        "compensating",
        "compensated",
        "compensation_failed",
        "cancelled",
      ]),
      "pending",
    ),
    attempt: db.default(z.integer(), 0),
    maxAttempts: db.default(z.integer(), 1),

    /**
     * Zero-based run counter for repeating steps (`repeat` option). Bumped
     * on every re-park; the retry budget (`attempt`) resets with it, so
     * retries are per-iteration. Always 0 for non-repeating steps.
     */
    iteration: db.default(z.integer(), 0),

    result: z.record(z.text(), z.any()).optional(),
    error: z.text().optional(),

    startedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),

    /**
     * Not-before time for a pending step: the next retry attempt, or the
     * end of a declared step `delay`. Null means runnable immediately.
     * The DB value is the source of truth — timers only optimize latency.
     */
    scheduledAt: z.datetime().optional(),
  }),
  indexes: [
    { columns: ["workflowExecutionId", "stepName"] },
    { columns: ["workflowExecutionId", "stepIndex"] },
    { columns: ["workflowExecutionId", "status"] },
    { columns: ["status", "scheduledAt"] },
  ],
});

export type WorkflowStepExecutionEntity = Infer<
  typeof workflowStepExecutions.schema
>;

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "compensating"
  | "compensated"
  | "compensation_failed"
  | "cancelled";
