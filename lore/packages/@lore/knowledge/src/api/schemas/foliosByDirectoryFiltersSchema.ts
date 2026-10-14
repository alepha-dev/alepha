import { type Infer, z } from "alepha";

/**
 * The `foliosByDirectory` dashboard metric's filters (#Q2658): none.
 */
export const foliosByDirectoryFiltersSchema = z.object({});

export type FoliosByDirectoryFilters = Infer<
  typeof foliosByDirectoryFiltersSchema
>;
