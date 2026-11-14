import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `releaseProgress` metric.
 *
 * Empty, for the same reason `epicProgressFiltersSchema` is: the card points
 * at one release and reports how far along it is, and the denominator is a
 * decision rather than a switch.
 */
export const releaseProgressFiltersSchema = z.object({});

export type ReleaseProgressFilters = Infer<typeof releaseProgressFiltersSchema>;
