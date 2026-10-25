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
 * Created against completed over the board's window, cumulative (#Q2653).
 *
 * Read from `ProjectReportsService.createdByDay` / `completedByDay`, the
 * queries the Reports burn-up draws, so the two agree. The series is the
 * completed line; the created total rides in `detail` and the footer, since
 * a card value carries one series.
 */
export class BurnupMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "burnup";

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
      const [created, completed] = await Promise.all([
        this.reports.createdByDay(project.id),
        this.reports.completedByDay(project.id),
      ]);
      const done = this.series.cumulative(completed, entry.windowDays);
      const made = this.series.cumulative(created, entry.windowDays);
      out.set(entry.card.id, {
        ...(made[made.length - 1]?.value ? {} : { empty: "noQuests" as const }),
        value: done[done.length - 1]?.value ?? 0,
        series: done,
        detail: {
          created: made[made.length - 1]?.value ?? 0,
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
