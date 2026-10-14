import { type Infer, z } from "alepha";

/**
 * The `momentum` dashboard metric's filters (#Q2659): none.
 */
export const momentumFiltersSchema = z.object({});

export type MomentumFilters = Infer<typeof momentumFiltersSchema>;
