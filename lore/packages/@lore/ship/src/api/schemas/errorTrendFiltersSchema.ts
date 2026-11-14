import { type Infer, z } from "alepha";

/**
 * The `errorTrend` dashboard metric's filters (#Q2657): none.
 */
export const errorTrendFiltersSchema = z.object({});

export type ErrorTrendFilters = Infer<typeof errorTrendFiltersSchema>;
