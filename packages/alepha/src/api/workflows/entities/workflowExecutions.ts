import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

/**
 * Workflow execution record — one row per started workflow.
 *
 * Status transitions:
 * - start                  → running (or `pending` when delayed)
 * - all steps completed    → completed
 * - step exhausted retries → failed (onError: "fail") or compensating → compensated
 * - compensate step throws → compensation_failed
 * - deadline exceeded      → timed_out
 * - cancel()               → cancelled
 */
export const workflowExecutions = $entity({
  name: "workflow_executions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    workflowName: z.text(),
    tags: z.array(z.text()).optional(),

    payload: z.record(z.text(), z.any()).optional(),

    /**
     * Ambient context captured at start() from the atoms listed in the
     * workflow's `context` option, keyed by atom name. Restored into a
     * fresh scope around every step, `when()` and compensation handler —
     * including sweep-driven dispatches on another process, which is the
     * point: the tenant that started the workflow follows it anywhere.
     */
    context: z.record(z.text(), z.any()).optional(),

    status: db.default(
      z.enum([
        "pending",
        "running",
        "completed",
        "failed",
        "timed_out",
        "compensating",
        "compensated",
        "compensation_failed",
        "cancelled",
      ]),
      "pending",
    ),
    currentStep: z.text().optional(),

    startedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),
    deadlineAt: z.datetime().optional(),

    /**
     * Intended start time. Set for every execution (now, unless started
     * with `delay`); the recovery sweep uses it to dispatch pending
     * executions whose start was lost to a crash.
     */
    scheduledAt: z.datetime().optional(),

    error: z.text().optional(),
    errorStep: z.text().optional(),

    triggeredBy: z.text().optional(),
    triggeredByName: z.text().optional(),
    cancelledBy: z.text().optional(),
    cancelledByName: z.text().optional(),

    key: z.text().nullable().optional(),

    priority: db.default(z.integer().min(0).max(3), 2),
  }),
  indexes: [
    { columns: ["workflowName", "status"] },
    { columns: ["workflowName", "status", "createdAt"] },
    {
      columns: ["workflowName", "key"],
      unique: true,
      where: sql`status NOT IN ('completed', 'failed', 'timed_out', 'compensated', 'compensation_failed', 'cancelled')`,
    },
    { columns: ["status", "deadlineAt"] },
    { columns: ["completedAt"] },
  ],
});

export type WorkflowExecutionEntity = Infer<typeof workflowExecutions.schema>;

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "compensating"
  | "compensated"
  | "compensation_failed"
  | "cancelled";
