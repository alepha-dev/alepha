import { $entity, pg } from "../../orm/index.ts";
import { t } from "../../core/providers/TypeProvider.ts";

export const workflowExecutionEntity = $entity({
  name: "workflow_executions",
  schema: t.object({
    workflowId: pg.primaryKey(t.uuid({ description: "Unique workflow execution ID" })),
    workflowName: t.text({ description: "Workflow definition name" }),
    workflowVersion: t.text({ description: "Workflow definition version" }),
    runId: t.uuid({ description: "Current run ID (for retries)" }),
    status: pg.enum(["running", "completed", "failed", "canceled", "compensating"], {
      name: "workflow_status",
    }),
    input: t.json({ description: "Workflow input data" }),
    output: t.optional(t.json({ description: "Workflow output data" })),
    state: t.json({ description: "Current workflow state" }),
    error: t.optional(t.longText({ description: "Error details if failed" })),
    parentWorkflowId: t.optional(
      pg.ref(
        t.uuid({ description: "Parent workflow ID for child workflows" }),
        () => workflowExecutionEntity.cols.workflowId,
      ),
    ),
    startedAt: t.datetime({ description: "Workflow start timestamp" }),
    completedAt: t.optional(t.datetime({ description: "Workflow completion timestamp" })),
    updatedAt: t.datetime({ description: "Last update timestamp" }),
  }),
  indexes: [
    { columns: ["workflowName", "status"] },
    { columns: ["parentWorkflowId"] },
    { columns: ["startedAt"] },
  ],
});
