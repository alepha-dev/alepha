import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { appHealthFiltersSchema } from "../schemas/appHealthFiltersSchema.ts";
import { errorTrendFiltersSchema } from "../schemas/errorTrendFiltersSchema.ts";
import { hostsCardFiltersSchema } from "../schemas/hostsCardFiltersSchema.ts";
import { qualityTrendFiltersSchema } from "../schemas/qualityTrendFiltersSchema.ts";
import { uptimeCardFiltersSchema } from "../schemas/uptimeCardFiltersSchema.ts";

/**
 * Deploy's apps tiles of #E77 (#Q2657): per-copy health, the error trend
 * with its deployments, and coverage; then hosts and uptime (#Q3781). Declarative and browser-safe, like
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
    this.catalog.register({
      ...common,
      key: "qualityTrend",
      order: 83,
      labelKey: "dashboard.metric.qualityTrend",
      hintKey: "dashboard.metric.qualityTrend.hint",
      icon: "shield-check",
      presentation: "trend",
      filters: qualityTrendFiltersSchema,
      needs: { capability: "ship" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "reportsQuality",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    // The machines and the monitors (#Q3781): what runs the apps, and
    // whether they answer.
    this.catalog.register({
      ...common,
      key: "hosts",
      order: 84,
      labelKey: "dashboard.metric.hosts",
      hintKey: "dashboard.metric.hosts.hint",
      icon: "server",
      presentation: "list",
      filters: hostsCardFiltersSchema,
      needs: { capability: "ship" },
      requires: "host:read",
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectSettingsHosts",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    this.catalog.register({
      ...common,
      key: "uptime",
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
