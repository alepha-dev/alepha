import { type Infer, z } from "alepha";

/**
 * The `foliosThisMonth` dashboard metric's filters (#Q2658): none.
 */
export const foliosThisMonthFiltersSchema = z.object({});

export type FoliosThisMonthFilters = Infer<typeof foliosThisMonthFiltersSchema>;
