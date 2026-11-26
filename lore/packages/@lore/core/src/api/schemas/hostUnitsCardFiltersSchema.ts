import { type Infer, z } from "alepha";

/**
 * The `hostUnits` card's filter (#Q4425): which host, by slug; empty is the
 * project's first own host that watches a unit.
 */
export const hostUnitsCardFiltersSchema = z.object({
  host: z.string().max(64).default(""),
});

export type HostUnitsCardFilters = Infer<typeof hostUnitsCardFiltersSchema>;
