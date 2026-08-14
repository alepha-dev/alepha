import { type Infer, z } from "alepha";

/**
 * One day of workflow activity (completed/failed counts) for the admin chart.
 */
export const workflowActivityPointSchema = z.object({
  date: z.text(),
  completed: z.integer(),
  failed: z.integer(),
});

export type WorkflowActivityPoint = Infer<typeof workflowActivityPointSchema>;
