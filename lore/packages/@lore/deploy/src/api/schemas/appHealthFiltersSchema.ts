import { type Infer, z } from "alepha";

/**
 * The `appHealth` dashboard metric's filters (#Q2657): none.
 */
export const appHealthFiltersSchema = z.object({});

export type AppHealthFilters = Infer<typeof appHealthFiltersSchema>;
