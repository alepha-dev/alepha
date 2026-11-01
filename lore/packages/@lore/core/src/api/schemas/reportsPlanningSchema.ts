import { type Infer, z } from "alepha";

/**
 * The Reports Planning tab (#Q3003): the project's epics, then its releases.
 */
export const reportsPlanningSchema = z.object({
  /**
   * Every started epic overlapping the period, oldest start first.
   */
  epics: z.array(
    z.object({
      id: z.integer(),
      number: z.integer(),
      title: z.string(),
      status: z.string(),
      startedAt: z.string(),
      completedAt: z.string().optional(),
      done: z.integer(),
      total: z.integer(),
      medianCycleHours: z.number(),
      daysInProgress: z.number(),
      scopeAdded: z.integer(),
      scopeCut: z.integer(),
      /**
       * Quests added or cut over what the epic started with, as a percentage.
       */
      scopeChange: z.number(),
    }),
  ),
  /**
   * The burn-up of one epic: the one the bar's epic filter names, else the
   * latest still in progress.
   */
  burnup: z
    .object({
      epicId: z.integer(),
      title: z.string(),
      points: z.array(
        z.object({
          date: z.string(),
          done: z.integer(),
          scope: z.integer(),
        }),
      ),
    })
    .optional(),
});

export type ReportsPlanning = Infer<typeof reportsPlanningSchema>;
