import { type Infer, z } from "alepha";

import { insightsDimensionSchema } from "./insightsDimensionSchema.ts";
import { insightsRangeSchema } from "./insightsRangeSchema.ts";
import { trafficFilterSchema } from "./trafficFilterSchema.ts";

/**
 * One leaderboard, in full, for the "More" view behind an overview card.
 *
 * A separate response from `insightsResourceSchema` rather than a wider
 * `TOP_N` on it: the overview draws ten rows of six leaderboards, and it must
 * not pay for a hundred rows of each to let one of them be expanded.
 *
 * Every row carries its visitors and views; `percentage` is its share of
 * the window's views.
 */
export const insightsDimensionResourceSchema = z.object({
  dimension: insightsDimensionSchema,
  range: z.union([insightsRangeSchema, z.literal("custom")]),
  traffic: trafficFilterSchema,
  from: z.string(),
  to: z.string(),
  /**
   * Views over the window under the filters: what `percentage` is a share
   * of.
   */
  total: z.integer(),
  rows: z.array(
    z.object({
      value: z.string(),
      visitors: z.integer().nullable(),
      views: z.integer(),
      percentage: z.number(),
    }),
  ),
  visitorsFrom: z.string().nullable(),
  offset: z.integer(),
  limit: z.integer(),
  hasMore: z.boolean(),
  estimated: z.boolean(),
});

export type InsightsDimensionResource = Infer<
  typeof insightsDimensionResourceSchema
>;
