import { type Infer, z } from "alepha";

/**
 * The Reports Team tab (#Q3013): balance rather than output. Nothing here is
 * ranked: the members come back by name.
 */
export const reportsTeamSchema = z.object({
  members: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      picture: z.string().optional(),
      /**
       * Open quests they took, not on hold. As it stands, whatever the period.
       */
      wip: z.integer(),
      held: z.integer(),
      /**
       * Their open quests past `dueAt`, held ones included.
       */
      overdue: z.integer(),
      questsCreated: z.integer(),
      questsCompleted: z.integer(),
      comments: z.integer(),
      folioRevisions: z.integer(),
      feedbackTriaged: z.integer(),
      deploys: z.integer(),
      /**
       * Every write of theirs in the period, and those that came over MCP: an
       * agent's work is recorded under the API key's owner.
       */
      writes: z.integer(),
      agentWrites: z.integer(),
    }),
  ),
  /**
   * Writes in the period by the way they arrived, largest first, members or
   * not. `unknown` is what was written before the channel was recorded.
   */
  channels: z.array(z.object({ channel: z.string(), count: z.integer() })),
  /**
   * Writes per weekday (Monday first) and UTC hour, over the last 30 days of
   * the period at most: past that the dataset keeps days, not hours (#Q3014).
   */
  heatmap: z.array(z.array(z.integer())),
  automations: z.object({
    runs: z.array(z.object({ status: z.string(), count: z.integer() })),
    /**
     * Runs that reached an end, of which `succeeded`, and how long they took.
     */
    finished: z.integer(),
    succeeded: z.integer(),
    medianSeconds: z.number(),
    p85Seconds: z.number(),
    broken: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  /**
   * MCP calls that resolved this project, per tool, busiest first.
   */
  mcp: z.array(
    z.object({
      tool: z.string(),
      ok: z.integer(),
      refused: z.integer(),
      error: z.integer(),
    }),
  ),
  /**
   * The figures come from a sampled backend.
   */
  estimated: z.boolean(),
});

export type ReportsTeam = Infer<typeof reportsTeamSchema>;
