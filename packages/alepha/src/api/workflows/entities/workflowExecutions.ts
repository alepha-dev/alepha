import { type Static, t } from "alepha";
import { $entity, db, sql } from "alepha/orm";

export const workflowExecutions = $entity({
  name: "workflow_executions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    workflowName: t.text(),
    tags: t.optional(t.array(t.text())),

    payload: t.optional(t.record(t.text(), t.any())),

    status: db.default(
      t.enum([
        "pending",
        "running",
        "waiting_for_signal",
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
    currentStep: t.optional(t.text()),

    startedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),
    deadlineAt: t.optional(t.datetime()),

    error: t.optional(t.text()),
    errorStep: t.optional(t.text()),

    triggeredBy: t.optional(t.text()),
    triggeredByName: t.optional(t.text()),
    cancelledBy: t.optional(t.text()),
    cancelledByName: t.optional(t.text()),

    key: t.optional(t.nullable(t.text())),

    priority: db.default(t.integer({ minimum: 0, maximum: 3 }), 2),
  }),
  indexes: [
    { columns: ["workflowName", "status"] },
    { columns: ["workflowName", "status", "createdAt"] },
    {
      columns: ["workflowName", "key"],
      unique: true,
      where: sql`status NOT IN ('completed', 'failed', 'compensated', 'compensation_failed', 'cancelled')`,
    },
    { columns: ["status", "deadlineAt"] },
    { columns: ["completedAt"] },
  ],
});

export type WorkflowExecutionEntity = Static<typeof workflowExecutions.schema>;

export type WorkflowStatus =
  | "pending"
  | "running"
  | "waiting_for_signal"
  | "completed"
  | "failed"
  | "timed_out"
  | "compensating"
  | "compensated"
  | "compensation_failed"
  | "cancelled";
