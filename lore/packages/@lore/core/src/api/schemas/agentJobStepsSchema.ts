import { type Infer, z } from "alepha";

/**
 * A running agent job's steps, counted by Lore from the quests the job's
 * key accepted (#Q4433, epic #E181), never asked of the agent and never
 * kept as a counter on the job row: Plan reads them from its quests through
 * the `AgentJobSteps` port, and an ended job keeps the count it ended with
 * (`host_jobs.steps`, written once by `HostJobService.end`).
 *
 * `unit` says what a step is: a quest for `work-loose-quests` and
 * `work-epic`, an objective for `work-quest`, which works one quest.
 * `done` of `total` steps, `stepTimes` the times of the done ones in order,
 * which the pace of #Q4436 reads.
 */
export const agentJobStepsSchema = z.object({
  unit: z.enum(["quest", "objective"]),
  total: z.integer().min(0),
  done: z.integer().min(0),
  /**
   * One entry per quest the job accepted, in accept order. A quest handed
   * back or unassigned stays here, not done.
   */
  quests: z
    .array(
      z.object({
        shortId: z.integer(),
        title: z.string(),
        acceptedAt: z.string().optional(),
        completedAt: z.string().optional(),
        objectives: z.object({
          total: z.integer().min(0),
          done: z.integer().min(0),
          waived: z.integer().min(0),
        }),
      }),
    )
    .max(200),
  /**
   * A `work-epic` job's quests of its epic it has not accepted yet.
   */
  pending: z
    .array(z.object({ shortId: z.integer(), title: z.string() }))
    .max(200),
  /**
   * The quest being worked: among those not done, the one with the latest
   * accept or objective tick.
   */
  current: z.integer().optional(),
  /**
   * The latest accept, objective tick or completion over the job's quests.
   */
  lastStepAt: z.string().optional(),
  stepTimes: z.array(z.string()).max(500),
});

export type AgentJobStepsValue = Infer<typeof agentJobStepsSchema>;
