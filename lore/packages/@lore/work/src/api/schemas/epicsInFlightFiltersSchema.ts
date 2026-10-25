import { type Infer, z } from "alepha";

/**
 * The `epicsInFlight` dashboard metric's filters (#Q2654): none.
 */
export const epicsInFlightFiltersSchema = z.object({});

export type EpicsInFlightFilters = Infer<typeof epicsInFlightFiltersSchema>;
