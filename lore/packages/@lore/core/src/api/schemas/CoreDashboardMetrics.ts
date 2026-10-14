import { $inject } from "alepha";

import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import { needsYouFiltersSchema } from "./needsYouFiltersSchema.ts";

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
  }
}
