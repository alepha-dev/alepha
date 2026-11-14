import { type Infer, z } from "alepha";

/**
 * The `qualityTrend` dashboard metric's filters (#Q2657): none.
 */
export const qualityTrendFiltersSchema = z.object({});

export type QualityTrendFilters = Infer<typeof qualityTrendFiltersSchema>;
