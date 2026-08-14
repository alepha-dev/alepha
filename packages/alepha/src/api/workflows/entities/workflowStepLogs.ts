import { type Infer, z } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { $entity, db } from "alepha/orm";

/**
 * Captured log entries for one step execution. Same id as the step
 * execution row; kept in a separate table so listing steps never drags
 * log payloads along.
 *
 * No FK on `id` — the ORM cannot express a primary key that is also a
 * reference, so nothing cascades here. The purge deletes log rows
 * explicitly by step id before deleting the executions.
 */
export const workflowStepLogs = $entity({
  name: "workflow_step_logs",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    logs: z.array(logEntrySchema),
  }),
});

export type WorkflowStepLogEntity = Infer<typeof workflowStepLogs.schema>;
