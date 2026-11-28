import { z } from "alepha";

/**
 * One leaderboard row: a value of a dimension, its visitors (null where
 * they are not known, as for bots) and its views.
 */
export const insightsLeaderboardRowSchema = z.object({
  value: z.string(),
  visitors: z.integer().nullable(),
  views: z.integer(),
});
