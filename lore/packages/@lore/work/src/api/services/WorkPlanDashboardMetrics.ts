import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { draftEpicsFiltersSchema } from "../schemas/draftEpicsFiltersSchema.ts";
import { epicsInFlightFiltersSchema } from "../schemas/epicsInFlightFiltersSchema.ts";
import { releaseOutlookFiltersSchema } from "../schemas/releaseOutlookFiltersSchema.ts";
import { releasesToPublishFiltersSchema } from "../schemas/releasesToPublishFiltersSchema.ts";

/**
 * Work's plan tiles (#E77, #Q2654): the release the project is heading for,
 * the releases waiting on a publish, the epics in flight and the ones being
 * specified. Declarative and browser-safe, like `WorkDashboardMetrics`.
 *
 * Each declares the Work OPTION it reads, so a project with releases or
 * epics off is never offered, nor computed, a tile about them.
 */
export class WorkPlanDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    const common = {
      boards: ["project" as const],
      group: "epics" as const,
      scopeKinds: ["projects" as const],
    };

    this.catalog.register({
      ...common,
      key: "releaseOutlook",
      clause: (value) => {
        const tag = String(value.detail.tag ?? "");
        if (value.detail.readyToPublish) {
          return { key: "dashboard.clause.releaseReady", args: [tag] };
        }
        if (value.value === undefined) return undefined;
        const days = value.detail.daysLeft;
        return typeof days === "number"
          ? {
              key: "dashboard.clause.releaseShips",
              args: [tag, String(days), String(value.value)],
            }
          : {
              key: "dashboard.clause.release",
              args: [tag, String(value.value)],
            };
      },
      order: 41,
      labelKey: "dashboard.metric.releaseOutlook",
      hintKey: "dashboard.metric.releaseOutlook.hint",
      icon: "flag",
      presentation: "progress",
      filters: releaseOutlookFiltersSchema,
      needs: { capability: "work", option: "releases" },
      link: (_scope, target) =>
        target.projectSlug && target.releaseTag
          ? {
              route: "projectRelease",
              params: {
                projectSlug: target.projectSlug,
                releaseTag: target.releaseTag,
              },
            }
          : undefined,
    });
    this.catalog.register({
      ...common,
      key: "releasesToPublish",
      clause: (value) =>
        (value.value ?? 0) > 0
          ? {
              key:
                value.value === 1
                  ? "dashboard.clause.releasesToPublish.one"
                  : "dashboard.clause.releasesToPublish",
              args: [String(value.value)],
            }
          : undefined,
      order: 42,
      labelKey: "dashboard.metric.releasesToPublish",
      hintKey: "dashboard.metric.releasesToPublish.hint",
      icon: "package-check",
      presentation: "list",
      filters: releasesToPublishFiltersSchema,
      needs: { capability: "work", option: "releases" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectReleases",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    this.catalog.register({
      ...common,
      key: "epicsInFlight",
      clause: (value) =>
        (value.value ?? 0) > 0
          ? {
              key:
                value.value === 1
                  ? "dashboard.clause.epicsInFlight.one"
                  : "dashboard.clause.epicsInFlight",
              args: [String(value.value)],
            }
          : undefined,
      order: 31,
      labelKey: "dashboard.metric.epicsInFlight",
      hintKey: "dashboard.metric.epicsInFlight.hint",
      icon: "layers",
      presentation: "list",
      filters: epicsInFlightFiltersSchema,
      needs: { capability: "work", option: "epics" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectEpics",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
    this.catalog.register({
      ...common,
      key: "draftEpics",
      order: 32,
      labelKey: "dashboard.metric.draftEpics",
      hintKey: "dashboard.metric.draftEpics.hint",
      icon: "pencil-ruler",
      presentation: "list",
      filters: draftEpicsFiltersSchema,
      needs: { capability: "work", option: "epics" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectEpics",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
  }
}
