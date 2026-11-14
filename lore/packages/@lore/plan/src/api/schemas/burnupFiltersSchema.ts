import { type Infer, z } from "alepha";

/**
 * The `burnup` dashboard metric's filters (#Q2653): none, the board's window
 * is the only knob.
 */
export const burnupFiltersSchema = z.object({});

export type BurnupFilters = Infer<typeof burnupFiltersSchema>;
