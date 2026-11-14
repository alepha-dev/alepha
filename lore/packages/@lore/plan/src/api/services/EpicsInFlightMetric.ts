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

import { epics } from "../entities/epics.ts";
import { EpicProgressService } from "./EpicProgressService.ts";

/**
 * Epics in progress, each with its bar (#Q2654): what the project is
 * building now. Progress from `EpicProgressService`, the rollup the Epics list
 * reads, as `completed / (total - shelved)`.
 */
export class EpicsInFlightMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "epicsInFlight";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly epics = $repository(epics);
  protected readonly progress = $inject(EpicProgressService);

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
      const rows = await this.epics.findMany({
        where: { projectId: { eq: project.id }, status: { eq: "in_progress" } },
        orderBy: [{ column: "number", direction: "asc" }],
        limit: 20,
      });
      const buckets = await this.progress.computeProgressOf(
        rows.map((epic) => epic.id),
      );
      out.set(entry.card.id, {
        ...(rows.length === 0 ? { empty: "noEpic" as const } : {}),
        value: rows.length,
        rows: rows.map((epic) => {
          const progress = buckets.get(epic.id) ?? {
            completed: 0,
            inProgress: 0,
            shelved: 0,
            total: 0,
          };
          const denominator = progress.total - progress.shelved;
          return {
            id: `E${epic.number}`,
            title: epic.title,
            progress:
              denominator > 0
                ? Math.round((progress.completed / denominator) * 100)
                : 0,

            state: "accent" as const,
            link: {
              route: "projectEpic",
              params: {
                // Every project carries a slug; the column is optional only in its schema.
                projectSlug: project.slug ?? "",
                epicNumber: String(epic.number),
              },
            },
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
