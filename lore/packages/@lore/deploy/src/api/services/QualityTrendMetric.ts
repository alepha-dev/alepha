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

import { QualityService } from "./QualityService.ts";

/**
 * Line coverage over the recorded quality runs, with the latest test counts
 * (#Q2657), from `QualityService`, the Quality report's own read.
 */
export class QualityTrendMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "qualityTrend";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly quality = $inject(QualityService);

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
      const runs = (await this.quality.findSeries(project.id, 30)).toReversed();
      const latest = runs[runs.length - 1];
      if (!latest) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const previous = runs[runs.length - 2];
      out.set(entry.card.id, {
        value: Math.round(latest.coverageLines),
        series: runs.map((run) => ({ at: run.day, value: run.coverageLines })),
        detail: {
          testsPassed: latest.testsPassed,
          testsTotal: latest.testsTotal,
          testsFailed: latest.testsFailed,
          // In points, not as a `delta`: coverage is already a percentage,
          // and a percent change of a percentage reads as nonsense.
          changePoints: previous
            ? Math.round((latest.coverageLines - previous.coverageLines) * 10) /
              10
            : null,
        },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }
}
