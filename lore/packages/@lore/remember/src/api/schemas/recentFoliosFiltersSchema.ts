import { type Infer, z } from "alepha";

/**
 * The `recentFolios` dashboard metric's filters (#Q2658): none.
 */
export const recentFoliosFiltersSchema = z.object({});

export type RecentFoliosFilters = Infer<typeof recentFoliosFiltersSchema>;
