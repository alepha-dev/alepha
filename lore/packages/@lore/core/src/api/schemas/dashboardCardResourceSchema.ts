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
  /**
   * Rows the tile spans, 1 or 2 (#Q2651). Absent reads as 1: a stored row
   * from before the column, or a tile the computed board built.
   */
  height: z.integer().optional(),
  /**
   * The heading this card sits under, when it has one (#Q2651).
   */
  section: z.string().optional(),
  position: z.integer(),
  /**
   * The slot of the computed board this tile fills (#Q2652): `headline`,
   * `needsYou`, `yourWork`, `flow`, `plan`, `apps`, `knowledge`, `feed`.
   * Absent on a stored card, which belongs to no slot.
   */
  slot: z.string().optional(),
});

export type DashboardCardResource = Infer<typeof dashboardCardResourceSchema>;
