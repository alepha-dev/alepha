import { type Infer, z } from "alepha";

export const workflowStatsSchema = z.object({
  registered: z.integer(),
  running: z.integer(),
  pending: z.integer(),
  completed: z.integer(),
  failed: z.integer(),
  compensated: z.integer(),
  compensationFailed: z.integer(),
  cancelled: z.integer(),
  timedOut: z.integer(),
});

export type WorkflowStats = Infer<typeof workflowStatsSchema>;
