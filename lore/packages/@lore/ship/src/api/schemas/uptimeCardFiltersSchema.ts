import { type Infer, z } from "alepha";

/**
 * The `uptime` dashboard metric's filters (#Q3781): none.
 */
export const uptimeCardFiltersSchema = z.object({});

export type UptimeCardFilters = Infer<typeof uptimeCardFiltersSchema>;
