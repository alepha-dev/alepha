import type { Infer } from "alepha";
import { z } from "alepha";

export const userStatsQuerySchema = z.object({
  /**
   * Length of the sign-up windows, in whole UTC days: today plus the days
   * before it. The previous window is the same number of days just before.
   * Whole days because the lists a dashboard tile opens filter by day.
   */
  windowDays: z.integer().min(1).max(366).optional(),
  /**
   * Length of the rolling `connected` window, in hours.
   */
  connectedHours: z.integer().min(1).max(8784).optional(),
});

export type UserStatsQuery = Infer<typeof userStatsQuerySchema>;
