import { type Infer, z } from "alepha";

/**
 * The `completedPerWeek` dashboard metric's filters (#Q2653): none, the board's window
 * is the only knob.
 */
export const completedPerWeekFiltersSchema = z.object({});

export type CompletedPerWeekFilters = Infer<
  typeof completedPerWeekFiltersSchema
>;
