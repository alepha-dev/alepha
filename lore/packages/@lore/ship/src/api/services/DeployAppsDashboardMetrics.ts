import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { appHealthFiltersSchema } from "../schemas/appHealthFiltersSchema.ts";
import { backupFreshnessFiltersSchema } from "../schemas/backupFreshnessFiltersSchema.ts";
import { errorTrendFiltersSchema } from "../schemas/errorTrendFiltersSchema.ts";
import { recentDeploymentsFiltersSchema } from "../schemas/recentDeploymentsFiltersSchema.ts";
import { uptimeCardFiltersSchema } from "../schemas/uptimeCardFiltersSchema.ts";
import { uptimeLatencyCardFiltersSchema } from "../schemas/uptimeLatencyCardFiltersSchema.ts";
import { webVitalsFiltersSchema } from "../schemas/webVitalsFiltersSchema.ts";

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
    // How fast the pages feel (#Q4521): p75 LCP, INP and CLS, one pill
    // each, narrowed to a copy by its sigil like the visitors tile.
    this.catalog.register({
      ...common,
      key: "webVitals",
      requires: "app:read",
      order: 83,
      labelKey: "dashboard.metric.webVitals",
      hintKey: "dashboard.metric.webVitals.hint",
      icon: "gauge",
      presentation: "status",
      scopeKinds: ["apps", "projects"],
      filters: webVitalsFiltersSchema,
      needs: { capability: "ship", option: "track" },
      needsBeacon: true,
      defaultSize: { size: 2, height: 1 },
      link: (_scope, target) =>
        target.projectSlug && target.app && target.env
          ? {
              route: "appVitals",
              params: {
                projectSlug: target.projectSlug,
                app: target.app,
                env: target.env,
              },
            }
          : undefined,
    });
    // What went out, where, when and by whom (#Q4522): every copy's
    // deployments, newest first, narrowed to copies by their sigil.
    this.catalog.register({
      ...common,
      key: "recentDeployments",
      requires: "app:read",
      order: 84,
      labelKey: "dashboard.metric.recentDeployments",
      hintKey: "dashboard.metric.recentDeployments.hint",
      icon: "rocket",
      presentation: "feed",
      scopeKinds: ["projects", "apps"],
      filters: recentDeploymentsFiltersSchema,
      needs: { capability: "ship", option: "deploy" },
      defaultSize: { size: 2, height: 1 },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectApps",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    // How old each copy's last Bay snapshot is (#Q4523), as the machine's
    // inventory reports it.
    this.catalog.register({
      ...common,
      key: "backupFreshness",
      requires: "app:read",
      order: 89,
      labelKey: "dashboard.metric.backupFreshness",
      hintKey: "dashboard.metric.backupFreshness.hint",
      icon: "database-backup",
      presentation: "list",
      scopeKinds: ["projects", "apps"],
      filters: backupFreshnessFiltersSchema,
      needs: { capability: "ship" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectApps",
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
    // Latency, certificates and the outages-and-restarts feed (#Q4426),
    // gated like the Uptime page.
    const uptimePage = (target: { projectSlug?: string }) =>
      target.projectSlug
        ? {
            route: "projectUptime",
            params: { projectSlug: target.projectSlug },
          }
        : undefined;
    this.catalog.register({
      ...common,
      key: "uptimeLatency",
      requires: "app:read",
      order: 86,
      labelKey: "dashboard.metric.uptimeLatency",
      hintKey: "dashboard.metric.uptimeLatency.hint",
      icon: "gauge",
      presentation: "chart",
      filters: uptimeLatencyCardFiltersSchema,
      needs: { capability: "ship", option: "uptime" },
      link: (_scope, target) => uptimePage(target),
    });
    this.catalog.register({
      ...common,
      key: "certExpiry",
      requires: "app:read",
      order: 87,
      labelKey: "dashboard.metric.certExpiry",
      hintKey: "dashboard.metric.certExpiry.hint",
      icon: "flag",
      presentation: "list",
      filters: uptimeCardFiltersSchema,
      needs: { capability: "ship", option: "uptime" },
      link: (_scope, target) => uptimePage(target),
    });
    this.catalog.register({
      ...common,
      key: "incidents",
      requires: "app:read",
      order: 88,
      labelKey: "dashboard.metric.incidents",
      hintKey: "dashboard.metric.incidents.hint",
      icon: "triangle-alert",
      presentation: "feed",
      filters: uptimeCardFiltersSchema,
      needs: { capability: "ship", option: "uptime" },
      link: (_scope, target) => uptimePage(target),
    });
  }
}
