import { type Infer, z } from "alepha";

/**
 * The `hosts` dashboard metric's filters (#Q3781): none.
 */
export const hostsCardFiltersSchema = z.object({});

export type HostsCardFilters = Infer<typeof hostsCardFiltersSchema>;
