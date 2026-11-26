import { type Infer, z } from "alepha";

/**
 * What a running job's own pace says of the steps it has left (#Q4436,
 * epic #E181), from `AgentJobPace.of`: the range in minutes, `low` the pace
 * up to the last step and `high` the pace counting the time since it, and
 * whether the steps left may not fit before the job's timeout. The range
 * is for the steps only, never for the review, checks and merge after them.
 */
export const agentJobPaceSchema = z.object({
  left: z.integer().min(1),
  low: z.integer().min(0),
  high: z.integer().min(0),
  warning: z.boolean(),
});

export type AgentJobPaceValue = Infer<typeof agentJobPaceSchema>;
