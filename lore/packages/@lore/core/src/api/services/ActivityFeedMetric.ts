import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { ProjectController } from "../controllers/ProjectController.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";

/**
 * The project's last recorded writes (#Q2659), as the Activity page lists
 * them: read through `ProjectController.activityPage`, the page's own read
 * behind its gate, so the
 * tile is narrowed to the enabled capabilities exactly as the page is, and
 * names actors the same way.
 */
export class ActivityFeedMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);
  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly projects = $inject(ProjectController);
  protected readonly dateTime = $inject(DateTimeProvider);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "activityFeed";

  /**
   * The typed reference prefix per resource kind, for the row's chip.
   */
  protected readonly prefixes: Record<string, string> = {
    quest: "Q",
    epic: "E",
    folio: "F",
    feedback: "P",
    release: "R",
  };

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
      // The board's window: the feed slot's data gate is "anything in it".
      const page = await this.projects.activityPage(project.id, {
        size: 8,
        after: this.dateTime
          .now()
          .subtract(entry.windowDays, "day")
          .toISOString(),
      });
      const rows = page.content;
      out.set(entry.card.id, {
        ...(rows.length === 0 ? { empty: "noActivity" as const } : {}),
        value: rows.length,
        rows: rows.map((row) => {
          const prefix = this.prefixes[row.resourceType ?? ""];
          return {
            ...(prefix && row.resourceId
              ? { id: `${prefix}${row.resourceId}` }
              : {}),
            title: row.description || `${row.action} ${row.type}`,
            at: row.updatedAt ?? row.createdAt,
            excerpt: row.actor,
          };
        }),
        detail: {},
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
        }),
      });
    }
    return out;
  }
}
