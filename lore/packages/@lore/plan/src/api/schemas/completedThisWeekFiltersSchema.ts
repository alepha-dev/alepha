import { type Infer, z } from "alepha";

/**
 * The `completedThisWeek` dashboard metric's filters (#Q2653): none, the board's window
 * is the only knob.
 */
export const completedThisWeekFiltersSchema = z.object({});

export type CompletedThisWeekFilters = Infer<
  typeof completedThisWeekFiltersSchema
>;
