import { z } from "alepha";

/**
 * The windows a host's Stats tab offers (#Q4528): the last hour, today, the
 * last 7 days and the last 30 days. Each reads at a grain that fits it:
 * minutes, hours, then days.
 */
export const hostStatsRangeSchema = z.enum(["hour", "today", "week", "month"]);
