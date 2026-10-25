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

import type { QuestBreakdownFilters } from "../schemas/questBreakdownFiltersSchema.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * The project's quests by area, tag or priority, as stacked segments
 * (#Q2653): the Reports Quests tab's three breakdowns, read from
 * `ProjectReportsService.questsReport`, top eight each as Reports draws them.
 *
 * ⚠️ By tag, a quest with two tags counts in both, as Reports says under
 * its own heading.
 */
export class QuestBreakdownMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "questBreakdown";

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
      const { by } = entry.filters as QuestBreakdownFilters;
      const report = await this.reports.questsReport(project.id);
      const groups =
        by === "tag"
          ? report.byTag.map((row) => ({ ...row, label: row.tag }))
          : by === "priority"
            ? report.byPriority.map((row) => ({ ...row, label: row.priority }))
            : report.byArea.map((row) => ({ ...row, label: row.area }));
      const segments = groups
        .map((row) => ({
          label: row.label,
          value: row.completed + row.remaining,
        }))
        .filter((segment) => segment.value > 0);
      out.set(entry.card.id, {
        ...(segments.length === 0 ? { empty: "noQuests" as const } : {}),
        segments,
        detail: { by },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
        }),
      });
    }
    return out;
  }
}
