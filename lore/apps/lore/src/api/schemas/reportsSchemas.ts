import { z } from "alepha";

/**
 * Response schemas for the three Reports dashboard endpoints. Shared by
 * `ProjectReportsController`, its tests, and the frontend page loaders.
 */

export const reportsOverviewSchema = z.object({
  kpis: z.object({
    totalQuests: z.integer(),
    completedQuests: z.integer(),
    openQuests: z.integer(),
    completedThisWeek: z.integer(),
    completedLastWeek: z.integer(),
    avgCycleTimeHours: z.number(),
    activeMembers: z.integer(),
  }),
  // Cumulative created vs completed, one point per day, oldest first.
  burnup: z.array(
    z.object({
      date: z.string(),
      created: z.integer(),
      completed: z.integer(),
    }),
  ),
  // Weekly completion rate (cumulative completed / cumulative created * 100).
  completionTrend: z.array(z.object({ date: z.string(), rate: z.number() })),
  attention: z.object({
    staleQuests: z.integer(),
    unassignedQuests: z.integer(),
    blockedQuests: z.integer(),
  }),
});

export const reportsQuestsSchema = z.object({
  funnel: z.object({
    new: z.integer(),
    accepted: z.integer(),
    completed: z.integer(),
  }),
  byArea: z.array(
    z.object({
      area: z.string(),
      completed: z.integer(),
      remaining: z.integer(),
    }),
  ),
  byPriority: z.array(
    z.object({
      priority: z.string(),
      completed: z.integer(),
      remaining: z.integer(),
    }),
  ),
  cycleTimeByPriority: z.array(
    z.object({ priority: z.string(), avgHours: z.number() }),
  ),
  // Oldest still-open (accepted, not completed) quests — actionable list.
  aging: z.array(
    z.object({
      shortId: z.integer(),
      title: z.string(),
      area: z.string(),
      priority: z.string(),
      ageDays: z.integer(),
    }),
  ),
});

export const reportsMembersSchema = z.object({
  leaderboard: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      picture: z.string().optional(),
      questsCompleted: z.integer(),
    }),
  ),
  // Top contributors' names — drives the dynamic stacked-area ChartConfig.
  contributors: z.array(z.string()),
  // Weekly completions; `counts` keyed by contributor name (from `contributors`).
  contribution: z.array(
    z.object({
      date: z.string(),
      counts: z.record(z.text(), z.integer()),
    }),
  ),
  idle: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      picture: z.string().optional(),
      lastCompletedAt: z.string().optional(),
    }),
  ),
});
