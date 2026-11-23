import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { appHealthFiltersSchema } from "../schemas/appHealthFiltersSchema.ts";
import { errorTrendFiltersSchema } from "../schemas/errorTrendFiltersSchema.ts";
import { uptimeCardFiltersSchema } from "../schemas/uptimeCardFiltersSchema.ts";

/**
 * Deploy's apps tiles of #E77 (#Q2657): per-copy health and the error trend
 * with its deployments; then uptime (#Q3781). Coverage is Build's
 * since #E162. Declarative and browser-safe, like
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
      requires: "app:read",
      order: 81,
      labelKey: "dashboard.metric.appHealth",
      hintKey: "dashboard.metric.appHealth.hint",
      icon: "activity",
      presentation: "status",
      filters: appHealthFiltersSchema,
      needs: { capability: "ship" },
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
      requires: "error:read",
      order: 82,
      labelKey: "dashboard.metric.errorTrend",
      hintKey: "dashboard.metric.errorTrend.hint",
      icon: "bug",
      presentation: "chart",
      chartStyle: "bars",
      filters: errorTrendFiltersSchema,
      needs: { capability: "ship", option: "track" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectErrors",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    // The monitors (#Q3781): whether the apps answer. The hosts card is
    // core's since #E166.
    this.catalog.register({
      ...common,
      key: "uptime",
      requires: "app:read",
      order: 85,
      labelKey: "dashboard.metric.uptime",
      hintKey: "dashboard.metric.uptime.hint",
      icon: "heart-pulse",
      presentation: "list",
      filters: uptimeCardFiltersSchema,
      needs: { capability: "ship", option: "uptime" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectApps",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
  }
}
