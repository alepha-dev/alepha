import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";

import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * Quests completed per week, the last eight weeks, as bars (#Q2653).
 *
 * From `ProjectReportsService.completedByDay`, the Reports query, bucketed
 * by `DashboardFlowSeries.weekly`.
 */
export class CompletedPerWeekMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "completedPerWeek";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly series = $inject(DashboardFlowSeries);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();
    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const completed = await this.reports.completedByDay(project.id);
      const weeks = this.series.weekly(completed, 8);
      const total = weeks.reduce((sum, week) => sum + week.value, 0);
      out.set(entry.card.id, {
        ...(total === 0 ? { empty: "noActivity" as const } : {}),
        value: total,
        series: weeks,
        detail: {
          windowCompletions: this.series.total(completed, entry.windowDays),
        },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
        }),
      });
    }
    return out;
  }
}
