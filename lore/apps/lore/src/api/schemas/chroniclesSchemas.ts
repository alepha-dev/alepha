import { t } from "alepha";

/**
 * Response schemas for the three Chronicles dashboard endpoints. Shared by
 * `CampaignStatsController`, its tests, and the frontend page loaders.
 */

export const chroniclesOverviewSchema = t.object({
  kpis: t.object({
    totalQuests: t.integer(),
    completedQuests: t.integer(),
    openQuests: t.integer(),
    completedThisWeek: t.integer(),
    completedLastWeek: t.integer(),
    avgCycleTimeHours: t.number(),
    activeCharacters: t.integer(),
  }),
  // Cumulative created vs completed, one point per day, oldest first.
  burnup: t.array(
    t.object({
      date: t.string(),
      created: t.integer(),
      completed: t.integer(),
    }),
  ),
  // Weekly completion rate (cumulative completed / cumulative created * 100).
  completionTrend: t.array(t.object({ date: t.string(), rate: t.number() })),
  attention: t.object({
    staleQuests: t.integer(),
    unassignedQuests: t.integer(),
    blockedQuests: t.integer(),
  }),
});

export const chroniclesQuestsSchema = t.object({
  funnel: t.object({
    new: t.integer(),
    accepted: t.integer(),
    completed: t.integer(),
  }),
  byZone: t.array(
    t.object({
      zone: t.string(),
      completed: t.integer(),
      remaining: t.integer(),
    }),
  ),
  byPriority: t.array(
    t.object({
      priority: t.string(),
      completed: t.integer(),
      remaining: t.integer(),
    }),
  ),
  cycleTimeByPriority: t.array(
    t.object({ priority: t.string(), avgHours: t.number() }),
  ),
  // Oldest still-open (accepted, not completed) quests — actionable list.
  aging: t.array(
    t.object({
      shortId: t.integer(),
      title: t.string(),
      zone: t.string(),
      priority: t.string(),
      ageDays: t.integer(),
    }),
  ),
});

export const chroniclesPartySchema = t.object({
  leaderboard: t.array(
    t.object({
      userId: t.string(),
      name: t.string(),
      picture: t.optional(t.string()),
      questsCompleted: t.integer(),
      xp: t.integer(),
      gold: t.integer(),
    }),
  ),
  // Top contributors' names — drives the dynamic stacked-area ChartConfig.
  contributors: t.array(t.string()),
  // Weekly completions; `counts` keyed by contributor name (from `contributors`).
  contribution: t.array(
    t.object({
      date: t.string(),
      counts: t.record(t.text(), t.integer()),
    }),
  ),
  idle: t.array(
    t.object({
      userId: t.string(),
      name: t.string(),
      picture: t.optional(t.string()),
      lastCompletedAt: t.optional(t.string()),
    }),
  ),
});
