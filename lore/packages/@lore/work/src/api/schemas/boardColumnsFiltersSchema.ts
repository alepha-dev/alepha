import { type Infer, z } from "alepha";

/**
 * The `boardColumns` dashboard metric's filters (#Q2653): none, the board's window
 * is the only knob.
 */
export const boardColumnsFiltersSchema = z.object({});

export type BoardColumnsFilters = Infer<typeof boardColumnsFiltersSchema>;
