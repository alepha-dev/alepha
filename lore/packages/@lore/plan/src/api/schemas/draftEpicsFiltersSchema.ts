import { type Infer, z } from "alepha";

/**
 * The `draftEpics` dashboard metric's filters (#Q2654): none.
 */
export const draftEpicsFiltersSchema = z.object({});

export type DraftEpicsFilters = Infer<typeof draftEpicsFiltersSchema>;
