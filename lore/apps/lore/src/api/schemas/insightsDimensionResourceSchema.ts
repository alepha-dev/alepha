import { type Infer, z } from "alepha";

import { trafficFilterSchema } from "./trafficFilterSchema.ts";

/**
 * One leaderboard, in full, for the "More" view behind an overview card.
 *
 * A separate response from `insightsResourceSchema` rather than a wider
 * `TOP_N` on it: the overview draws ten rows of six leaderboards, and it must
 * not pay for a hundred rows of each to let one of them be expanded.
 *
 * `count` and `percentage` mean whatever the dimension's own measure means -
 * views for pages, countries, referrers and devices; arrivals for entry paths
 * and campaigns - which is the same asymmetry the overview already has, and
 * the reason `measure` is on the payload rather than left to the caller to
 * remember.
 */
export const insightsDimensionResourceSchema = z.object({
  dimension: z.enum([
    "country",
    "path",
    "entryPath",
    "campaign",
    "device",
    "referrer",
    "browser",
    "os",
  ]),
  /**
   * Which measure the rows are counted and ranked by, echoed back so a caller
   * can label the column without knowing the mapping.
   */
  measure: z.enum(["count", "entries"]),
  range: z.enum(["1d", "7d", "30d"]),
  traffic: trafficFilterSchema,
  since: z.string(),
  until: z.string(),
  /**
   * The measure summed over the whole filtered window: the denominator every
   * row's `percentage` is a share of.
   *
   * On the payload because the page cannot compute it from `rows` - a page
   * of ten rows out of two hundred sums to a fraction of it, and dividing by
   * that would report a share of the page instead of a share of the traffic.
   */
  total: z.integer(),
  rows: z.array(
    z.object({
      value: z.string(),
      count: z.integer(),
      /**
       * Share of `total`, rounded to a whole percent.
       */
      percentage: z.number(),
    }),
  ),
  offset: z.integer(),
  limit: z.integer(),
  /**
   * Whether another page exists past this one.
   *
   * Measured by asking for one row more than the page and dropping it, not by
   * a second counting query: the analytics seam offers no `COUNT(DISTINCT)`
   * over a grouping, and a total row count is not worth a whole extra pass
   * over the window to draw a "next" button with.
   */
  hasMore: z.boolean(),
  estimated: z.boolean(),
  sampleInterval: z.number().optional(),
});

export type InsightsDimensionResource = Infer<
  typeof insightsDimensionResourceSchema
>;
