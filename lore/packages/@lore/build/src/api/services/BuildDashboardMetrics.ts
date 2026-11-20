import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { qualityTrendFiltersSchema } from "../schemas/qualityTrendFiltersSchema.ts";

/**
 * Build's coverage tile (#E77, #Q2657), moved from Ship's apps tiles with
 * Quality (#E162). Declarative and browser-safe, like every catalog
 * declaration; project boards only. The number tiles are
 * `QualityNumericCatalog`'s.
 */
export class BuildDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    this.catalog.register({
      boards: ["project"],
      group: "apps",
      scopeKinds: ["projects"],
      key: "qualityTrend",
      requires: "quality:read",
      order: 83,
      labelKey: "dashboard.metric.qualityTrend",
      hintKey: "dashboard.metric.qualityTrend.hint",
      icon: "shield-check",
      presentation: "trend",
      filters: qualityTrendFiltersSchema,
      needs: { capability: "build", option: "quality" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "reportsQuality",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
  }
}
