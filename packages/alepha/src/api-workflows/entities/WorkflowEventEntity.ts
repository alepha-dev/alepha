import { $entity, pg } from "../../orm/index.ts";
import { t } from "../../core/providers/TypeProvider.ts";
import { workflowExecutionEntity } from "./WorkflowExecutionEntity.ts";

export const workflowEventEntity = $entity({
  name: "workflow_events",
  schema: t.object({
    eventId: pg.primaryKey(t.uuid({ description: "Unique event ID" })),
    workflowId: pg.ref(
      t.uuid({ description: "Parent workflow ID" }),
      () => workflowExecutionEntity.cols.workflowId,
    ),
    sequence: t.int({ description: "Event sequence number (for ordering)" }),
    eventType: t.text({ description: "Event type (WorkflowStarted, ActivityScheduled, etc.)" }),
    eventData: t.json({ description: "Event payload data" }),
    timestamp: t.datetime({ description: "Event timestamp" }),
  }),
  indexes: [
    { columns: ["workflowId", "sequence"], unique: true },
    { columns: ["workflowId", "timestamp"] },
  ],
});
