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

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { sigils } from "../entities/sigils.ts";
import { ErrorSeriesWindow } from "./ErrorSeriesWindow.ts";

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
  protected readonly datasets = $inject(DeployAnalytics);
  protected readonly window = $inject(ErrorSeriesWindow);
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
      const days = this.window.days(entry.windowDays);
      const [errors, markers] = await Promise.all([
        this.datasets.errors.query({
          since: days[0]!,
          until: days[days.length - 1]!,
          where: { sigilId: { inArray: apps.map((app) => app.id) } },
          groupBy: ["day"],
          select: { count: "sum" },
        }),
        this.window.deploys(project.id, days[0]!),
      ]);
      const byDay = new Map(
        errors.rows.map((row) => [String(row.day), Number(row.count)]),
      );
      const series = days.map((at) => ({ at, value: byDay.get(at) ?? 0 }));
      const total = series.reduce((sum, point) => sum + point.value, 0);
      out.set(entry.card.id, {
        value: total,
        series,
        markers,
        detail: { deployments: markers.length },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }
}
