import { z } from "alepha";

/**
 * What `ProjectReportsService` answers, for Flow, the Summary and the dashboard
 * tiles.
 */

/**
 * What one period adds up to: returned for the period asked for, and for the
 * one before it when the query says `compare` (#Q2995).
 */
export const reportsPeriodFiguresSchema = z.object({
  created: z.integer(),
  completed: z.integer(),
  medianCycleTimeHours: z.number(),
  p85CycleTimeHours: z.number(),
  activeMembers: z.integer(),
});

export const reportsOverviewSchema = z.object({
  kpis: z.object({
    totalQuests: z.integer(),
    completedQuests: z.integer(),
    // Accepted and not completed. A held quest is its own state, not open.
    openQuests: z.integer(),
    heldQuests: z.integer(),
    completedThisWeek: z.integer(),
    completedLastWeek: z.integer(),
    // Accepted to completed, hold time taken out.
    medianCycleTimeHours: z.number(),
    p85CycleTimeHours: z.number(),
    // Members who created, accepted, completed or commented on a quest lately.
    activeMembers: z.integer(),
  }),
  period: reportsPeriodFiguresSchema,
  // Absent without `compare`, or when the period has no start.
  previous: reportsPeriodFiguresSchema.optional(),
  // Cumulative created vs completed, one point per grain over the period (the
  // last 90 days without a `from`), oldest first. The totals include everything
  // before it.
  burnup: z.array(
    z.object({
      date: z.string(),
      created: z.integer(),
      completed: z.integer(),
    }),
  ),
  attention: z.object({
    staleQuests: z.integer(),
    notStartedQuests: z.integer(),
    blockedQuests: z.integer(),
  }),
});

export const reportsQuestsSchema = z.object({
  funnel: z.object({
    todo: z.integer(),
    inProgress: z.integer(),
    held: z.integer(),
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
  /**
   * Completed vs remaining per TAG, top 8 by volume.
   *
   * ⚠️ A quest carries several tags, so a quest is counted once per tag it
   * holds and these rows do NOT sum to the project's quest count - unlike
   * `byArea` and `byPriority`, where every quest lands in exactly one row.
   * That is the axis working as intended (a `bug` that is also a
   * `regression` belongs to both), and it is why this cannot be read as a
   * share of the whole.
   */
  byTag: z.array(
    z.object({
      tag: z.string(),
      completed: z.integer(),
      remaining: z.integer(),
    }),
  ),
  cycleTimeByPriority: z.array(
    z.object({
      priority: z.string(),
      medianHours: z.number(),
      p85Hours: z.number(),
    }),
  ),
  // Absent without `compare`, or when the period has no start.
  previous: z
    .object({
      completed: z.integer(),
      medianCycleTimeHours: z.number(),
      p85CycleTimeHours: z.number(),
    })
    .optional(),
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
