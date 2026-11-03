import { type Infer, z } from "alepha";

import { reportsPeriodFiguresSchema } from "./reportsSchemas.ts";

const questRef = {
  shortId: z.integer(),
  title: z.string(),
};

const histogram = z.array(
  z.object({
    /**
     * The bucket, a stable code the locale names:
     * `reports.flow.bucket.<key>`.
     */
    key: z.text(),
    count: z.integer(),
  }),
);

/**
 * The Reports Flow tab (#Q3000): how work moved through the period.
 */
export const reportsFlowSchema = z.object({
  period: reportsPeriodFiguresSchema,
  previous: reportsPeriodFiguresSchema.optional(),
  wip: z.integer(),
  grain: z.enum(["day", "week", "month"]),
  /**
   * Per grain: created, completed, the rolling median of completed over the
   * last four points, and the net growth of the backlog.
   */
  throughput: z.array(
    z.object({
      date: z.string(),
      created: z.integer(),
      completed: z.integer(),
      rollingMedian: z.number(),
      net: z.integer(),
    }),
  ),
  /**
   * Quests in each state, at the end of each grain. `exact` says the point is
   * a nightly snapshot rather than a reconstruction.
   */
  cumulative: z.array(
    z.object({
      date: z.string(),
      todo: z.integer(),
      inProgress: z.integer(),
      onHold: z.integer(),
      done: z.integer(),
      exact: z.boolean(),
    }),
  ),
  /**
   * One dot per completed quest, newest 500.
   */
  scatter: z.array(
    z.object({
      ...questRef,
      date: z.string(),
      hours: z.number(),
    }),
  ),
  cycleP50Hours: z.number(),
  cycleP85Hours: z.number(),
  leadP50Hours: z.number(),
  leadP85Hours: z.number(),
  cycleHistogram: histogram,
  leadHistogram: histogram,
  /**
   * The oldest quests in progress, held ones left out, against the percentile
   * bands of what got completed.
   */
  aging: z.array(
    z.object({
      ...questRef,
      ageDays: z.number(),
      band: z.enum(["under_p50", "under_p85", "over_p85"]),
    }),
  ),
  hold: z.object({
    quests: z.integer(),
    medianHours: z.number(),
    p85Hours: z.number(),
  }),
  columns: z.array(
    z.object({
      column: z.string(),
      quests: z.integer(),
      medianHours: z.number(),
      p85Hours: z.number(),
    }),
  ),
  /**
   * Cycle time per t-shirt size, smallest first (#Q3001).
   */
  sizes: z.array(
    z.object({
      size: z.integer(),
      quests: z.integer(),
      medianHours: z.number(),
      p85Hours: z.number(),
    }),
  ),
  /**
   * The estimate against what it took, for the quests that have one. Actual
   * is the time tracked on the quest's timer, or its cycle time without one.
   */
  estimates: z.array(
    z.object({
      ...questRef,
      estimateHours: z.number(),
      actualHours: z.number(),
      tracked: z.boolean(),
    }),
  ),
  /**
   * Quests completed in the period that had a deadline, and how many met it.
   */
  dueDates: z.object({
    withDue: z.integer(),
    onTime: z.integer(),
  }),
});

export type ReportsFlow = Infer<typeof reportsFlowSchema>;
