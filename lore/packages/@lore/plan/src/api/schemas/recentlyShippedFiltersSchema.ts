import { type Infer, z } from "alepha";

/**
 * The `recentlyShipped` dashboard metric's filters (#Q2655): none.
 */
export const recentlyShippedFiltersSchema = z.object({});

export type RecentlyShippedFilters = Infer<typeof recentlyShippedFiltersSchema>;
