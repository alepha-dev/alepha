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

import type { CycleTimeFilters } from "../schemas/cycleTimeFiltersSchema.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * Average hours from accepted to completed (#Q2653).
 *
 * Every priority reads the Reports Overview KPI; one priority reads the
 * Quests tab's per-priority figure. Both are `ProjectReportsService` calls,
 * so the tile and the Reports page cannot disagree. No delta: Reports keeps
 * no earlier window for this figure, and inventing one here would be the
 * second copy this quest exists to avoid.
 */
export class CycleTimeMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "cycleTime";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly reports = $inject(ProjectReportsService);

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
      const { priority } = entry.filters as CycleTimeFilters;
      const hours =
        priority === "all"
          ? (await this.reports.overview(project.id)).kpis.avgCycleTimeHours
          : ((
              await this.reports.questsReport(project.id)
            ).cycleTimeByPriority.find((row) => row.priority === priority)
              ?.avgHours ?? 0);
      out.set(entry.card.id, {
        ...(hours > 0 ? {} : { empty: "noData" as const }),
        value: Math.round(hours),
        detail: { priority },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
        }),
      });
    }
    return out;
  }
}
