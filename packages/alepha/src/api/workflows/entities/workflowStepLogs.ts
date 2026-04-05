import { type Static, t } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { $entity, db } from "alepha/orm";

export const workflowStepLogs = $entity({
  name: "workflow_step_logs",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    logs: t.array(logEntrySchema),
  }),
});

export type WorkflowStepLogEntity = Static<typeof workflowStepLogs.schema>;
