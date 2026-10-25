import { $inject } from "alepha";

import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { ProjectMomentumService } from "./ProjectMomentumService.ts";

/**
 * Recorded writes per day over the board's window, as bars (#Q2659): the
 * read Home's momentum strip makes, through `ProjectMomentumService`.
 *
 * ⚠️ A failed read FAILS the tile, through the registry's own catch, and is
 * never drawn as a window of quiet days: that would be a claim about a
 * fortnight nobody measured.
 */
export class MomentumMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);
  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly momentum = $inject(ProjectMomentumService);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "momentum";

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();
    const windowDays = cards[0]?.windowDays ?? 14;
    const days = this.momentum.days(windowDays);
    const projectIds = [
      ...new Set(cards.flatMap((entry) => entry.scope.projectIds)),
    ];
    // One read for every card, as Home makes it for every row.
    const read =
      projectIds.length > 0
        ? await this.momentum.read(projectIds.map(String), days)
        : [];
    const countsOf = new Map(read.map((it) => [it.projectId, it.counts]));

    for (const entry of cards) {
      const project = entry.scope.projects[0];
      const counts = project ? countsOf.get(project.id) : undefined;
      if (!project || !counts) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const total = counts.reduce((sum, count) => sum + count, 0);
      out.set(entry.card.id, {
        ...(total === 0 ? { empty: "noActivity" as const } : {}),
        value: total,
        series: days.map((at, index) => ({ at, value: counts[index] ?? 0 })),
        detail: {},
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
        }),
      });
    }
    return out;
  }
}
