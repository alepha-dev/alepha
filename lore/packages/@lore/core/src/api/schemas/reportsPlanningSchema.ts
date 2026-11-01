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
  /**
   * The project's releases (#Q3004).
   */
  releases: z.object({
    /**
     * Open releases holding work, nearest target first, three at most.
     */
    open: z.array(
      z.object({
        id: z.integer(),
        label: z.string(),
        targetDate: z.string().optional(),
        done: z.integer(),
        total: z.integer(),
        burnup: z.array(
          z.object({
            date: z.string(),
            done: z.integer(),
            scope: z.integer(),
          }),
        ),
        /**
         * Ship dates from a Monte Carlo over recent weekly throughput. Absent
         * when no quest closed recently, which predicts nothing.
         */
        forecast: z.object({ p50: z.string(), p85: z.string() }).optional(),
      }),
    ),
    /**
     * Published releases, newest first, from the counts frozen at publish.
     */
    published: z.array(
      z.object({
        id: z.integer(),
        label: z.string(),
        releasedAt: z.string(),
        /**
         * Days after the target, negative when early. Absent with no target.
         */
        slipDays: z.number().optional(),
        size: z.integer(),
        /**
         * What was still in progress at publish, and so carried over.
         */
        carriedOver: z.integer(),
        /**
         * Days since the previous published release.
         */
        cadenceDays: z.number().optional(),
      }),
    ),
  }),
});

export type ReportsPlanning = Infer<typeof reportsPlanningSchema>;
