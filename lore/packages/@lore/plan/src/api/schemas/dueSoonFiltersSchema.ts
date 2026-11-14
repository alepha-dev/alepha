import { type Infer, z } from "alepha";

/**
 * The `dueSoon` dashboard metric's filters (#Q2655): none.
 */
export const dueSoonFiltersSchema = z.object({});

export type DueSoonFilters = Infer<typeof dueSoonFiltersSchema>;
