import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { workflowExecutions } from "./workflowExecutions.ts";

export const workflowStepExecutions = $entity({
  name: "workflow_step_executions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    workflowExecutionId: db.ref(t.uuid(), () => workflowExecutions.cols.id, {
      onDelete: "cascade",
    }),

    stepName: t.text(),
    stepIndex: t.integer(),
    stepType: db.default(t.enum(["handler", "signal", "parallel"]), "handler"),

    parentStepId: t.optional(t.uuid()),
    branchName: t.optional(t.text()),

    status: db.default(
      t.enum([
        "pending",
        "running",
        "completed",
        "failed",
        "skipped",
        "waiting",
        "compensating",
        "compensated",
        "compensation_failed",
        "cancelled",
      ]),
      "pending",
    ),
    attempt: db.default(t.integer(), 0),
    maxAttempts: db.default(t.integer(), 1),

    result: t.optional(t.record(t.text(), t.any())),
    error: t.optional(t.text()),

    startedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),
    deadlineAt: t.optional(t.datetime()),

    signalPayload: t.optional(t.record(t.text(), t.any())),
    signalledBy: t.optional(t.text()),
    signalledAt: t.optional(t.datetime()),
  }),
  indexes: [
    { columns: ["workflowExecutionId", "stepName"] },
    { columns: ["workflowExecutionId", "stepIndex"] },
    { columns: ["workflowExecutionId", "status"] },
    { columns: ["status", "deadlineAt"] },
  ],
});

export type WorkflowStepExecutionEntity = Static<
  typeof workflowStepExecutions.schema
>;

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "waiting"
  | "compensating"
  | "compensated"
  | "compensation_failed"
  | "cancelled";
