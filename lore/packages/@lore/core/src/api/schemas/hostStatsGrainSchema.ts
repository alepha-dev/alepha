import { z } from "alepha";

/**
 * How fine a host's stats series is bucketed (#Q4528): a day, an hour, or a
 * minute where the dataset stores minutes (`host_stats` stores hours).
 */
export const hostStatsGrainSchema = z.enum(["day", "hour", "minute"]);
