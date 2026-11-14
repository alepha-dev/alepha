import { type Infer, z } from "alepha";

/**
 * The `releaseOutlook` dashboard metric's filters (#Q2654): none.
 */
export const releaseOutlookFiltersSchema = z.object({});

export type ReleaseOutlookFilters = Infer<typeof releaseOutlookFiltersSchema>;
