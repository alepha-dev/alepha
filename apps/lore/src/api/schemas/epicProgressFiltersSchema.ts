import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `epicProgress` metric.
 *
 * Empty. The card points at one epic and reports how far along it is; there
 * is no slice of that to take. The denominator is a DECISION, not a filter -
 * both progress cards divide by `total - shelved` and say so - so it is not
 * offered as a switch either.
 */
export const epicProgressFiltersSchema = z.object({});

export type EpicProgressFilters = Infer<typeof epicProgressFiltersSchema>;
