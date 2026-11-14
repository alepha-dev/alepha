import { type Infer, z } from "alepha";

/**
 * The `yourQuests` dashboard metric's filters (#Q2655): none.
 */
export const yourQuestsFiltersSchema = z.object({});

export type YourQuestsFilters = Infer<typeof yourQuestsFiltersSchema>;
