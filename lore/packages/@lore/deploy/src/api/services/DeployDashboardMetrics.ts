import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { openBlightsFiltersSchema } from "../schemas/openBlightsFiltersSchema.ts";
import { uniqueVisitorsFiltersSchema } from "../schemas/uniqueVisitorsFiltersSchema.ts";

/**
 * Deploy's blights and visitors metrics, as the dashboard catalogue lists them, registered on core's
 * `DashboardMetricCatalog` (#E75, #Q2623).
 *
 * The declarative half only, and browser-safe like the catalogue itself: it
 * is listed by `LoreDeployApi` and injected by `LoreDeployWeb`, so both runtimes
 * register it. How a
 * metric is computed is its resolver's, server-side.
 */
export class DeployDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    this.catalog.register({
      key: "openBlights",
      order: 60,
      boards: ["home"],
      group: "inbox",
      labelKey: "dashboard.metric.openBlights",
      hintKey: "dashboard.metric.openBlights.hint",
      icon: "bug",
      presentation: "scalar",
      scopeKinds: ["apps", "projects", "all"],
      filters: openBlightsFiltersSchema,
      /**
       * `apps.track`, not bare `apps`. Blights arrive on the same ingest
       * path the option governs, so a project that deploys without watching
       * has no source for this number.
       */
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
      key: "uniqueVisitors",
      order: 80,
      boards: ["home"],
      group: "apps",
      labelKey: "dashboard.metric.uniqueVisitors",
      hintKey: "dashboard.metric.uniqueVisitors.hint",
      icon: "users",
      presentation: "scalar",
      scopeKinds: ["apps", "projects"],
      filters: uniqueVisitorsFiltersSchema,
      needs: { capability: "apps", option: "track" },
      needsBeacon: true,
      /**
       * The analytics tab 404s when the app's own `kinds` lacks `beacon`
       * (`assertBeacon`), so the resolver only ever reports an app that
       * carries it. With no such app there is no destination and the card
       * is not clickable, which is the honest answer.
       */
      link: (_scope, target) =>
        target.projectSlug && target.app && target.env
          ? {
              route: "appAnalytics",
              params: {
                projectSlug: target.projectSlug,
                app: target.app,
                env: target.env,
              },
            }
          : undefined,
    });
  }
}
