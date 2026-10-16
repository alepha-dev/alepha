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
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { deployments } from "../entities/deployments.ts";
import { sigils } from "../entities/sigils.ts";

/**
 * Error occurrences per day over the board's window, with each finished
 * deployment as a dashed rule (#Q2657): did that deploy make it better or
 * worse.
 *
 * The SERIES from the `sigil_errors` dataset, exactly as the Errors tab
 * reads it, zero-filled here because only the caller knows the window.
 */
export class ErrorTrendMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "errorTrend";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly datasets = $inject(DeployAnalytics);
  protected readonly deployments = $repository(deployments);
  protected readonly sigils = $repository(sigils);

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
      const slug = project.slug ?? "";
      const apps = await this.sigils.findMany({
        where: { projectId: { eq: project.id } },
      });
      if (apps.length === 0) {
        out.set(entry.card.id, { empty: "noSigil", detail: {} });
        continue;
      }
      const today = this.dateTime.nowMillis();
      const days = Array.from({ length: entry.windowDays }, (_, index) =>
        new Date(today - (entry.windowDays - 1 - index) * 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
      const [errors, deployed] = await Promise.all([
        this.datasets.errors.query({
          since: days[0]!,
          until: days[days.length - 1]!,
          where: { sigilId: { inArray: apps.map((app) => app.id) } },
          groupBy: ["day"],
          select: { count: "sum" },
        }),
        // Never `log`, which holds a whole deploy log per row (#Q2682).
        this.deployments.findMany({
          columns: ["createdAt", "finishedAt"],
          where: {
            projectId: { eq: project.id },
            status: { eq: "succeeded" },
            createdAt: { gte: `${days[0]}T00:00:00.000Z` },
          },
          orderBy: [{ column: "createdAt", direction: "asc" }],
          limit: 50,
        }),
      ]);
      const byDay = new Map(
        errors.rows.map((row) => [String(row.day), Number(row.count)]),
      );
      const series = days.map((at) => ({ at, value: byDay.get(at) ?? 0 }));
      const total = series.reduce((sum, point) => sum + point.value, 0);
      out.set(entry.card.id, {
        value: total,
        series,
        markers: deployed.map((it) => ({
          at: it.finishedAt ?? it.createdAt,
          kind: "deploy",
        })),
        detail: { deployments: deployed.length },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }
}
