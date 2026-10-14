import {
  type DashboardCardLink,
  type DashboardCardTarget,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";

import { boardColumnsFiltersSchema } from "../schemas/boardColumnsFiltersSchema.ts";
import { burnupFiltersSchema } from "../schemas/burnupFiltersSchema.ts";
import { completedPerWeekFiltersSchema } from "../schemas/completedPerWeekFiltersSchema.ts";
import { completedThisWeekFiltersSchema } from "../schemas/completedThisWeekFiltersSchema.ts";
import { cycleTimeFiltersSchema } from "../schemas/cycleTimeFiltersSchema.ts";
import { questBreakdownFiltersSchema } from "../schemas/questBreakdownFiltersSchema.ts";

/**
 * Work's flow tiles (#E77, #Q2653): the Reports numbers as dashboard
 * metrics, registered on core's catalogue. Declarative and browser-safe, like
 * `WorkDashboardMetrics`; the resolvers wrap `ProjectReportsService`.
 *
 * Every one `requires: "stats:read"`, the Reports tabs' own gate, and is a
 * project-board metric only.
 */
export class WorkFlowDashboardMetrics {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    const toReports =
      (route: "reportsOverview" | "reportsQuests") =>
      (
        _scope: unknown,
        target: DashboardCardTarget,
      ): DashboardCardLink | undefined =>
        target.projectSlug
          ? { route, params: { projectSlug: target.projectSlug } }
          : undefined;
    const common = {
      boards: ["project" as const],
      group: "flow" as const,
      scopeKinds: ["projects" as const],
      needs: { capability: "work" as const },
      requires: "stats:read",
    };

    this.catalog.register({
      ...common,
      key: "burnup",
      order: 110,
      labelKey: "dashboard.metric.burnup",
      hintKey: "dashboard.metric.burnup.hint",
      icon: "trending-up",
      presentation: "chart",
      chartStyle: "area",
      filters: burnupFiltersSchema,
      link: toReports("reportsOverview"),
    });
    this.catalog.register({
      ...common,
      key: "completedPerWeek",
      order: 120,
      labelKey: "dashboard.metric.completedPerWeek",
      hintKey: "dashboard.metric.completedPerWeek.hint",
      icon: "bar-chart-3",
      presentation: "chart",
      chartStyle: "bars",
      filters: completedPerWeekFiltersSchema,
      link: toReports("reportsOverview"),
    });
    this.catalog.register({
      ...common,
      key: "completedThisWeek",
      order: 130,
      labelKey: "dashboard.metric.completedThisWeek",
      hintKey: "dashboard.metric.completedThisWeek.hint",
      icon: "check-circle-2",
      presentation: "trend",
      filters: completedThisWeekFiltersSchema,
      link: toReports("reportsOverview"),
    });
    this.catalog.register({
      ...common,
      key: "cycleTime",
      order: 140,
      labelKey: "dashboard.metric.cycleTime",
      hintKey: "dashboard.metric.cycleTime.hint",
      icon: "timer",
      presentation: "scalar",
      filters: cycleTimeFiltersSchema,
      link: toReports("reportsQuests"),
    });
    this.catalog.register({
      ...common,
      key: "questBreakdown",
      order: 150,
      labelKey: "dashboard.metric.questBreakdown",
      hintKey: "dashboard.metric.questBreakdown.hint",
      icon: "pie-chart",
      presentation: "progress",
      filters: questBreakdownFiltersSchema,
      link: toReports("reportsQuests"),
    });
    this.catalog.register({
      ...common,
      key: "boardColumns",
      order: 160,
      labelKey: "dashboard.metric.boardColumns",
      hintKey: "dashboard.metric.boardColumns.hint",
      icon: "kanban",
      presentation: "status",
      filters: boardColumnsFiltersSchema,
      needs: { capability: "work", option: "board" },
      link: (_scope, target) =>
        target.projectSlug
          ? {
              route: "projectKanban",
              params: { projectSlug: target.projectSlug },
            }
          : undefined,
    });
  }
}
