import { $entity, pg } from "../../orm/index.ts";
import { t } from "../../core/providers/TypeProvider.ts";
import { workflowExecutionEntity } from "./WorkflowExecutionEntity.ts";

export const humanTaskEntity = $entity({
  name: "human_tasks",
  schema: t.object({
    taskId: pg.primaryKey(t.uuid({ description: "Unique task ID" })),
    workflowId: pg.ref(
      t.uuid({ description: "Parent workflow ID" }),
      () => workflowExecutionEntity.cols.workflowId,
    ),
    taskType: t.text({ description: "Human task type" }),
    data: t.json({ description: "Task data for the human" }),
    status: pg.enum(["pending", "completed", "canceled"], {
      name: "human_task_status",
    }),
    assignedTo: t.optional(t.uuid({ description: "Assigned user ID" })),
    result: t.optional(t.json({ description: "Task result data" })),
    createdAt: t.datetime({ description: "Task creation timestamp" }),
    completedAt: t.optional(t.datetime({ description: "Task completion timestamp" })),
  }),
  indexes: [
    { columns: ["workflowId"] },
    { columns: ["status", "assignedTo"] },
    { columns: ["taskType", "status"] },
  ],
});
