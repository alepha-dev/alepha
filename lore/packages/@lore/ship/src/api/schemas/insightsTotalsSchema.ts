import { z } from "alepha";

/**
 * The numbers every reading carries, for the window and for the one before.
 * A visitor or visit figure is null where nothing counts it: under bots,
 * before v2's first day, or older than 400 days.
 */
export const insightsTotalsSchema = z.object({
  visitors: z.integer().nullable(),
  visits: z.integer().nullable(),
  views: z.integer().nullable(),
  /**
   * Shares in `[0, 1]`.
   */
  bounceRate: z.number().nullable(),
  engagedRate: z.number().nullable(),
  avgVisitSeconds: z.number().nullable(),
  pagesPerVisit: z.number().nullable(),
});
