import { z } from "alepha";

/**
 * What `getHomeBoard` answers: everything Home draws that `getHomeOverview`
 * does not already carry.
 *
 * Its own file because two sides read it: the action's response, and
 * `homeBoardAtom`, which the `home` route loader fills so the board is in the
 * first paint. The atom lives in the browser, and a controller file is not
 * something the browser can import.
 */
export const homeBoardSchema = z.object({
  /**
   * The days the momentum counts are indexed by, oldest first, as
   * `YYYY-MM-DD`. Sent rather than derived on the client so the bars
   * cannot drift from the buckets the database grouped: both ends
   * would otherwise decide what "today" means, in two timezones.
   */
  days: z.array(z.text()),
  /**
   * ⚠️ **Absent means the bars could not be read, not that nothing
   * happened.** Since #E65 the counts come from the `project_activity`
   * `$analytics` dataset, which on production is an HTTP call into
   * Analytics Engine - a dependency the rest of this response does not
   * have. Every Insights read 500'd for a day on 2026-08-11 and took
   * the Apps pages with it; Home must not be able to go the same way,
   * so the read catches to `undefined` and the strip renders empty.
   *
   * An empty ARRAY would have been indistinguishable from fourteen
   * quiet days, which is a different and much worse answer: it would
   * mute every row in the table as inactive.
   */
  momentum: z
    .array(
      z.object({
        projectId: z.integer(),
        /**
         * One number per entry of {@link days}, same order,
         * zero-filled.
         */
        counts: z.array(z.integer()),
      }),
    )
    .optional(),
  /**
   * When each project last saw any activity, whatever its kind: the
   * table's Last activity column. One entry per project.
   */
  lastActivity: z.array(
    z.object({
      projectId: z.integer(),
      at: z.datetime(),
    }),
  ),
  /**
   * What is open in each project beyond its quests, for the table's
   * Open column: draft epics, open blights, pending feedback. The
   * quest count is already on the overview (`openQuestCount`). One
   * entry per project, zeros included.
   */
  openCounts: z.array(
    z.object({
      projectId: z.integer(),
      epics: z.integer(),
      blights: z.integer(),
      feedback: z.integer(),
    }),
  ),
});
