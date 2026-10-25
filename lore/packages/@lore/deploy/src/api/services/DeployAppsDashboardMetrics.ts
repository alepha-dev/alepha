import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { appHealthFiltersSchema } from "../schemas/appHealthFiltersSchema.ts";
import { errorTrendFiltersSchema } from "../schemas/errorTrendFiltersSchema.ts";
import { qualityTrendFiltersSchema } from "../schemas/qualityTrendFiltersSchema.ts";

/**
 * Deploy's apps tiles of #E77 (#Q2657): per-copy health, the error trend
 * with its deployments, and coverage. Declarative and browser-safe, like
 * `DeployDashboardMetrics`; project boards only.
 */
export class DeployAppsDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    const common = {
      boards: ["project" as const],
      group: "apps" as const,
      scopeKinds: ["projects" as const],
    };

    this.catalog.register({
      ...common,
      key: "appHealth",
      clause: (value) => {
        const off = (value.rows ?? []).filter(
          (row) => row.state === "bad" || row.state === "warn",
        ).length;
        return off > 0
          ? {
              key:
                off === 1
                  ? "dashboard.clause.appHealth.one"
                  : "dashboard.clause.appHealth",
              args: [String(off)],
            }
          : undefined;
      },
      order: 81,
      labelKey: "dashboard.metric.appHealth",
      hintKey: "dashboard.metric.appHealth.hint",
      icon: "activity",
      presentation: "status",
      filters: appHealthFiltersSchema,
      needs: { capability: "apps" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectApps",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    this.catalog.register({
      ...common,
      key: "errorTrend",
      order: 82,
      labelKey: "dashboard.metric.errorTrend",
      hintKey: "dashboard.metric.errorTrend.hint",
      icon: "bug",
      presentation: "chart",
      chartStyle: "bars",
      filters: errorTrendFiltersSchema,
      needs: { capability: "apps", option: "track" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectBlights",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    this.catalog.register({
      ...common,
      key: "qualityTrend",
      order: 83,
      labelKey: "dashboard.metric.qualityTrend",
      hintKey: "dashboard.metric.qualityTrend.hint",
      icon: "shield-check",
      presentation: "trend",
      filters: qualityTrendFiltersSchema,
      needs: { capability: "apps" },
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
