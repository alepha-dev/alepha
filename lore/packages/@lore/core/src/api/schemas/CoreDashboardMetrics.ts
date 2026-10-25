import { $inject } from "alepha";

import { activityFeedFiltersSchema } from "./activityFeedFiltersSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
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
      clause: (value) =>
        (value.value ?? 0) > 0
          ? {
              key:
                value.value === 1
                  ? "dashboard.clause.needsYou.one"
                  : "dashboard.clause.needsYou",
              args: [String(value.value)],
            }
          : undefined,
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
    const toActivity = (_scope: unknown, target: { projectSlug?: string }) =>
      target.projectSlug
        ? {
            route: "projectActivity",
            params: { projectSlug: target.projectSlug },
          }
        : undefined;
    this.catalog.register({
      key: "activityFeed",
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
  }
}
