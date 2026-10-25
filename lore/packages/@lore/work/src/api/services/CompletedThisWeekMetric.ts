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
 * Quests completed in the last seven days, against the seven before, with
 * the window's daily completions as a sparkline (#Q2653).
 *
 * The same `completedByDay` rows Reports reads; "this week" is the last
 * seven days, as the Reports KPI tile counts it.
 */
export class CompletedThisWeekMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "completedThisWeek";

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
      const thisWeek = this.series.total(completed, 7);
      const lastWeek = this.series.total(completed, 14) - thisWeek;
      out.set(entry.card.id, {
        value: thisWeek,
        // Absent on a zero baseline: the change is undefined, not infinite.
        delta:
          lastWeek > 0
            ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
            : undefined,
        series: this.series.daily(completed, entry.windowDays),
        detail: {
          lastWeek,
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
