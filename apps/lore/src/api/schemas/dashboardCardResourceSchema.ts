import { type Infer, z } from "alepha";

import { dashboardScopeSchema } from "./dashboardScopeSchema.ts";

/**
 * One stored dashboard card, as the browser reads it.
 *
 * Configuration only — the *value* comes from `POST /me/dashboard/resolve`,
 * which takes the whole card list in one request. Splitting the two is what
 * keeps ten tiles from becoming ten round-trips.
 */
export const dashboardCardResourceSchema = z.object({
  id: z.integer(),
  metric: z.string(),
  scope: dashboardScopeSchema,
  /**
   * The metric's own filter values, already parsed against that metric's
   * schema — so a card stored before the vocabulary changed arrives at the
   * browser holding defaults rather than a shape nothing understands.
   */
  filters: z.record(z.text(), z.any()),
  size: z.integer(),
  position: z.integer(),
});

export type DashboardCardResource = Infer<typeof dashboardCardResourceSchema>;
