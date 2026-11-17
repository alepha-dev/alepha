import {
  type DashboardCardLink,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";

import { requirementsDashboardFiltersSchema } from "../schemas/requirementsDashboardFiltersSchema.ts";

/**
 * The Requirements cards of the dashboard catalogue (#E153, #Q3775), each
 * offered only with Plan's `requirements` option on.
 *
 * The declarative half only, and browser-safe like the catalogue itself: it
 * is listed by the package's api module and injected by its web module, so
 * both runtimes register it. How a card is computed is its resolver's, in
 * `RequirementsMetricResolvers`.
 */
export class RequirementsDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    const needs = { capability: "plan", option: "requirements" } as const;
    const to =
      (route: string, query?: Record<string, string>) =>
      (
        _scope: unknown,
        target: { projectSlug?: string },
      ): DashboardCardLink | undefined =>
        target.projectSlug
          ? {
              route,
              params: { projectSlug: target.projectSlug },
              ...(query ? { query } : {}),
            }
          : undefined;

    this.catalog.register({
      key: "requirementCoverage",
      requires: "requirement:read",
      order: 300,
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.requirementCoverage",
      hintKey: "dashboard.metric.requirementCoverage.hint",
      icon: "gauge",
      presentation: "progress",
      scopeKinds: ["projects", "release"],
      filters: requirementsDashboardFiltersSchema,
      needs,
      link: to("projectRequirements"),
    });
    this.catalog.register({
      key: "releaseReadiness",
      requires: "requirement:read",
      order: 301,
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.releaseReadiness",
      hintKey: "dashboard.metric.releaseReadiness.hint",
      icon: "flag",
      presentation: "progress",
      scopeKinds: ["release"],
      filters: requirementsDashboardFiltersSchema,
      needs,
      link: to("projectRequirements"),
    });
    this.catalog.register({
      key: "useCaseHealth",
      requires: "usecase:read",
      order: 302,
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.useCaseHealth",
      hintKey: "dashboard.metric.useCaseHealth.hint",
      icon: "heart-pulse",
      presentation: "progress",
      scopeKinds: ["projects"],
      filters: requirementsDashboardFiltersSchema,
      needs,
      link: to("projectUseCases"),
    });
    this.catalog.register({
      key: "requirementsToCover",
      requires: "requirement:read",
      order: 303,
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.requirementsToCover",
      hintKey: "dashboard.metric.requirementsToCover.hint",
      icon: "triangle-alert",
      presentation: "list",
      scopeKinds: ["projects", "release"],
      filters: requirementsDashboardFiltersSchema,
      needs,
      link: to("projectRequirements"),
    });
    this.catalog.register({
      key: "personaHealth",
      requires: "persona:read",
      order: 304,
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.personaHealth",
      hintKey: "dashboard.metric.personaHealth.hint",
      icon: "users",
      presentation: "list",
      scopeKinds: ["projects"],
      filters: requirementsDashboardFiltersSchema,
      needs,
      link: to("projectPersonas"),
    });
    this.catalog.register({
      key: "requirementCoverageTrend",
      requires: "requirement:read",
      order: 305,
      boards: ["project"],
      group: "epics",
      labelKey: "dashboard.metric.requirementCoverageTrend",
      hintKey: "dashboard.metric.requirementCoverageTrend.hint",
      icon: "activity",
      presentation: "chart",
      chartStyle: "area",
      scopeKinds: ["projects", "release"],
      filters: requirementsDashboardFiltersSchema,
      needs,
      link: to("projectRequirements"),
    });
  }
}
