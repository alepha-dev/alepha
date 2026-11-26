import { $inject } from "alepha";

import { activityFeedFiltersSchema } from "./activityFeedFiltersSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import { hostsCardFiltersSchema } from "./hostsCardFiltersSchema.ts";
import { hostStatsCardFiltersSchema } from "./hostStatsCardFiltersSchema.ts";
import { hostUnitsCardFiltersSchema } from "./hostUnitsCardFiltersSchema.ts";
import { momentumFiltersSchema } from "./momentumFiltersSchema.ts";
import { needsYouFiltersSchema } from "./needsYouFiltersSchema.ts";
import { noteFiltersSchema } from "./noteFiltersSchema.ts";

/**
 * Core's own dashboard metrics (#E77): the ones whose rows come from every
 * module through a core registry, so no module owns them. Declarative and
 * browser-safe, like the catalogue; injected by `LoreCoreApi` and
 * `LoreCoreWeb`.
 */
export class CoreDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    this.catalog.register({
      key: "needsYou",
      requires: "project:read",
      order: 5,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.needsYou",
      hintKey: "dashboard.metric.needsYou.hint",
      icon: "bell-dot",
      presentation: "list",
      scopeKinds: ["projects"],
      filters: needsYouFiltersSchema,
      // No `needs`: Core. Each SOURCE is gated by its own capability.
      // The tile's own drill-through is the quest list; each row links to
      // its own thing.
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectQuests",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });

    // The core tiles of #Q2659: always available, whatever the capabilities.
    // No link while the project's Activity switch is off (#Q4413): the page
    // does not exist then, and the tile would drill into a 404.
    const toActivity = (
      _scope: unknown,
      target: { projectSlug?: string; activity?: boolean },
    ) =>
      target.projectSlug && target.activity !== false
        ? {
            route: "projectActivity",
            params: { projectSlug: target.projectSlug },
          }
        : undefined;
    this.catalog.register({
      key: "activityFeed",
      requires: "project:read",
      order: 6,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.activityFeed",
      hintKey: "dashboard.metric.activityFeed.hint",
      icon: "history",
      presentation: "feed",
      scopeKinds: ["projects"],
      filters: activityFeedFiltersSchema,
      link: toActivity,
    });
    this.catalog.register({
      key: "momentum",
      requires: "project:read",
      order: 7,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.momentum",
      hintKey: "dashboard.metric.momentum.hint",
      icon: "bar-chart-2",
      presentation: "chart",
      chartStyle: "bars",
      scopeKinds: ["projects"],
      filters: momentumFiltersSchema,
      link: toActivity,
    });
    this.catalog.register({
      key: "note",
      order: 8,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.note",
      hintKey: "dashboard.metric.note.hint",
      icon: "sticky-note",
      presentation: "note",
      scopeKinds: ["projects"],
      filters: noteFiltersSchema,
      // A note goes nowhere: it is the destination.
      link: () => undefined,
    });
    // The machines (#Q3781), core's since #E166: a host is monitored with
    // Ship off, so the card needs no capability.
    this.catalog.register({
      key: "hosts",
      order: 84,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.hosts",
      hintKey: "dashboard.metric.hosts.hint",
      icon: "server",
      presentation: "list",
      scopeKinds: ["projects"],
      filters: hostsCardFiltersSchema,
      requires: "host:read",
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectSettingsHosts",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    // One host's CPU, memory, disk or load over time, and the systemd units
    // it watches (#Q4425). Core's, like `hosts`: no capability needed.
    this.catalog.register({
      key: "hostStats",
      order: 85,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.hostStats",
      hintKey: "dashboard.metric.hostStats.hint",
      icon: "gauge",
      presentation: "chart",
      scopeKinds: ["projects"],
      filters: hostStatsCardFiltersSchema,
      requires: "host:read",
      // The project's hosts; the resolver links the host's own page.
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectSettingsHosts",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    this.catalog.register({
      key: "hostUnits",
      order: 86,
      boards: ["project"],
      group: "core",
      labelKey: "dashboard.metric.hostUnits",
      hintKey: "dashboard.metric.hostUnits.hint",
      icon: "server",
      presentation: "status",
      scopeKinds: ["projects"],
      filters: hostUnitsCardFiltersSchema,
      requires: "host:read",
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectSettingsHosts",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
  }
}
