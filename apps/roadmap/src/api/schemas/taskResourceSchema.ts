import { type Static, t } from "alepha";
import { tasks } from "../entities/tasks.ts";

/**
 * Task status derived from acceptedAt / completedAt.
 */
export const taskStatusSchema = t.enum(["new", "accepted", "completed"]);

/**
 * Computed metadata attached to every task resource.
 */
export const taskMetadataSchema = t.object({
  status: taskStatusSchema,
  objectivesProgress: t.object({
    completed: t.integer(),
    total: t.integer(),
  }),
  totalTimeSpent: t.integer(),
});

/**
 * Task entity + server-computed metadata.
 */
export const taskResourceSchema = t.extend(tasks.schema, {
  metadata: taskMetadataSchema,
});

export type TaskResource = Static<typeof taskResourceSchema>;
