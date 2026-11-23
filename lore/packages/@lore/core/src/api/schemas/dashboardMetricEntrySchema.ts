import { type Infer, z } from "alepha";

/**
 * One metric a project board may show, as an agent or the CLI needs it to add a
 * card (#Q4206).
 */
export const dashboardMetricEntrySchema = z.object({
  key: z.string(),
  group: z.string(),
  presentation: z.string(),
  labelKey: z.string(),
  hintKey: z.string(),
  /**
   * Every scope kind the metric accepts on a project board.
   */
  scopeKinds: z.array(z.string()),
  /**
   * The JSON schema of the metric's `filters`.
   */
  filters: z.record(z.text(), z.any()),
  defaultFilters: z.record(z.text(), z.any()),
  needs: z
    .object({ capability: z.string(), option: z.string().optional() })
    .optional(),
  needsBeacon: z.boolean().optional(),
  requires: z.string().optional(),
  defaultSize: z.object({ size: z.integer(), height: z.integer() }).optional(),
});

export type DashboardMetricEntry = Infer<typeof dashboardMetricEntrySchema>;
