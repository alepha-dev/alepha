import { $entity, pg } from "../../orm/index.ts";
import { t } from "../../core/providers/TypeProvider.ts";
import { workflowExecutionEntity } from "./WorkflowExecutionEntity.ts";

export const workflowSignalQueueEntity = $entity({
  name: "workflow_signal_queue",
  schema: t.object({
    signalId: pg.primaryKey(t.uuid({ description: "Unique signal ID" })),
    workflowId: pg.ref(
      t.uuid({ description: "Target workflow ID" }),
      () => workflowExecutionEntity.cols.workflowId,
    ),
    signalName: t.text({ description: "Signal name (from $atom definition)" }),
    payload: t.json({ description: "Signal payload data" }),
    receivedAt: t.datetime({ description: "Signal received timestamp" }),
    processedAt: t.optional(t.datetime({ description: "Signal processed timestamp" })),
  }),
  indexes: [
    { columns: ["workflowId", "processedAt"] },
    { columns: ["signalName"] },
  ],
});
