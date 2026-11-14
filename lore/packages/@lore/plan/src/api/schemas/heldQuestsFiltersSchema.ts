import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `heldQuests` metric.
 *
 * Deliberately empty. A hold has no direction and no kind - #Q2082 settled
 * that, and the whole reason the card is labelled "On hold" rather than
 * "Waiting on you" is that the data cannot name a person. There is nothing
 * left to narrow by, so the wizard skips the filter step for this metric
 * rather than showing a control with one option.
 *
 * It exists as a schema rather than as an absent field because the descriptor
 * requires one, and because a metric that grows a filter later should do it
 * here rather than by changing the shape of the registry.
 */
export const heldQuestsFiltersSchema = z.object({});

export type HeldQuestsFilters = Infer<typeof heldQuestsFiltersSchema>;
