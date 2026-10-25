import { type Infer, z } from "alepha";

/**
 * The `needsYou` dashboard metric's filters (#Q2656): none.
 */
export const needsYouFiltersSchema = z.object({});

export type NeedsYouFilters = Infer<typeof needsYouFiltersSchema>;
