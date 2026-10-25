import { type Infer, z } from "alepha";

/**
 * The `activityFeed` dashboard metric's filters (#Q2659): none.
 */
export const activityFeedFiltersSchema = z.object({});

export type ActivityFeedFilters = Infer<typeof activityFeedFiltersSchema>;
