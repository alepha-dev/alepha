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
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { KanbanColumnConfig } from "../schemas/KanbanColumnConfig.ts";
import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * Open quests per kanban column, one pill each (#Q2653).
 *
 * Columns from `KanbanColumnConfig`, the board's own resolution, and each
 * quest placed by the board's rule (`KanbanGrouping`): its lane from its
 * lifecycle, then its named column inside that lane, else the lane's first.
 * The completed lane is left out: it only grows. The draft lane is left out
 * too (#Q4376): a dashboard tile leaves drafts out as every default view
 * does, so the tile's number is the open quests, and a Draft pill would read
 * 0 forever beside a board that shows them. A draft is never counted in To
 * do either: it is filtered out of the read. A column over its WIP limit
 * reads `warn`.
 */
export class BoardColumnsMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "boardColumns";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly quests = $repository(quests);
  protected readonly columns = $inject(KanbanColumnConfig);
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
      const where = this.quests.createQueryWhere();
      where.projectId = { eq: project.id };
      where.shelvedAt = { isNull: true };
      where.completedAt = { isNull: true };
      where.draftAt = { isNull: true };
      const open = await this.quests.findMany({
        where,
        columns: ["acceptedAt", "kanbanColumn"],
      });
      // The synthesized ends carry a code rather than a label: the locale
      // names them, through the pill's badge.
      const columns = this.columns
        .resolve(project, {
          draft: "draft",
          todo: "todo",
          completed: "completed",
        })
        .filter(
          (column) =>
            column.status !== "completed" && column.status !== "draft",
        );
      const counts = new Map(columns.map((column) => [column.name, 0]));
      for (const quest of open) {
        const lane = quest.acceptedAt ? "in_progress" : "todo";
        const candidates = columns.filter((column) => column.status === lane);
        const home =
          candidates.find((column) => column.name === quest.kanbanColumn) ??
          candidates[0];
        if (home) counts.set(home.name, (counts.get(home.name) ?? 0) + 1);
      }
      const completed = await this.reports.tileCompletedByDay(
        project.id,
        entry.reads,
      );
      out.set(entry.card.id, {
        ...(open.length === 0 ? { empty: "noQuests" as const } : {}),
        value: open.length,
        rows: columns.map((column) => {
          const count = counts.get(column.name) ?? 0;
          return {
            ...(column.synthesized
              ? { title: column.name, badge: column.name }
              : { id: column.name, title: column.name }),
            value: count,
            state:
              column.wipLimit !== undefined && count > column.wipLimit
                ? ("warn" as const)
                : column.status === "todo"
                  ? ("neutral" as const)
                  : ("accent" as const),
          };
        }),
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
