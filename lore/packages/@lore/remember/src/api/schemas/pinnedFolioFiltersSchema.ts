import { type Infer, z } from "alepha";

/**
 * The `pinnedFolio` dashboard metric's filters (#Q2658): none.
 */
export const pinnedFolioFiltersSchema = z.object({});

export type PinnedFolioFilters = Infer<typeof pinnedFolioFiltersSchema>;
