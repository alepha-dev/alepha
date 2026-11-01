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
   * The figures come from a sampled backend.
   */
  estimated: z.boolean(),
});

export type ReportsTeam = Infer<typeof reportsTeamSchema>;
