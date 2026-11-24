import { type Infer, z } from "alepha";

/**
 * A project's AI budget for its chat agents, as Settings > Chat > Agents
 * shows it (#Q4237).
 */
export const chatAgentBudgetResourceSchema = z.object({
  /**
   * The tokens the project's agent runs may spend per window, absent with
   * no project budget.
   */
  tokens: z.integer().optional(),
  /**
   * What the project paid for over the current window.
   */
  spent: z.integer(),
  /**
   * The window, in hours: the instance's, the same as a member's budget.
   */
  windowHours: z.integer(),
  /**
   * When enough of the window's spending ages out for a run to start again,
   * while the budget is spent.
   */
  freesAt: z.datetime().optional(),
});

export type ChatAgentBudgetResource = Infer<
  typeof chatAgentBudgetResourceSchema
>;
