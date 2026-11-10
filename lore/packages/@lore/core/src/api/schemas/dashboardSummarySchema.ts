import { type Infer, z } from "alepha";

/**
 * One of a project's dashboards, as the selector reads it (#E127, #Q3299).
 *
 * `id` is absent only on the implicit first dashboard of a project that has
 * no `project_dashboards` row yet. `name` and `slug` are absent on the first
 * dashboard nobody named, which the screen shows as the localized
 * "Dashboard" label and links as the project root.
 */
export const dashboardSummarySchema = z.object({
  id: z.integer().optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  position: z.integer(),
  /**
   * The project's first dashboard: the one `/:project` opens, the only one
   * that can be computed, customized and reset to default.
   */
  first: z.boolean(),
});

export type DashboardSummary = Infer<typeof dashboardSummarySchema>;
