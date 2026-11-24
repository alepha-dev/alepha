import { $inject } from "alepha";

import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import { qualityTrendFiltersSchema } from "./qualityTrendFiltersSchema.ts";

/**
 * Quality's coverage tile (#E77, #Q2657), moved from Ship's apps tiles with
 * Quality (#E162). Declarative and browser-safe, like every catalog
 * declaration; project boards only. The number tiles are
 * `QualityNumericCatalog`'s.
 */
export class QualityDashboardMetrics {
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
      needs: { capability: "reports", option: "quality" },
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
