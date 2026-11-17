import { type Infer, z } from "alepha";

/**
 * A ready-made dashboard layout (#Q3831), by key: see
 * `DashboardPresetCatalog`.
 */
export const dashboardPresetKeySchema = z
  .enum(["appVitals", "requirements", "triage", "delivery"])
  .meta({ mode: "text" });

export type DashboardPresetKey = Infer<typeof dashboardPresetKeySchema>;
