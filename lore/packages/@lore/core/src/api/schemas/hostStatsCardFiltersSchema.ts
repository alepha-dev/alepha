import { type Infer, z } from "alepha";

/**
 * The `hostStats` card's filters (#Q4425): which host, by slug (empty is the
 * project's first own host), and which of its series the chart draws.
 */
export const hostStatsCardFiltersSchema = z.object({
  host: z.string().max(64).default(""),
  measure: z.enum(["cpu", "memory", "disk", "load"]).default("cpu"),
});

export type HostStatsCardFilters = Infer<typeof hostStatsCardFiltersSchema>;
