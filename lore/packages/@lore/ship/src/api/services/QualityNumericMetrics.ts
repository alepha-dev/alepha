import {
  DashboardMetricRegistry,
  type DashboardResolvable,
} from "@lore/core/api";
import type { DashboardCardValue } from "@lore/core/schemas";
import { $inject } from "alepha";

import { qualityNumericFiltersSchema } from "../schemas/qualityNumericFiltersSchema.ts";
import { QualityNumericCatalog } from "./QualityNumericCatalog.ts";
import { QualityService } from "./QualityService.ts";

/**
 * The dashboard resolver is also the automation resolver. Exact closed UTC
 * dates and their provenance travel together; missing data never becomes zero.
 */
export class QualityNumericMetrics {
  protected readonly dashboard = $inject(DashboardMetricRegistry);
  protected readonly quality = $inject(QualityService);
  constructor() {
    for (const [metric, { column }] of Object.entries(
      QualityNumericCatalog.metrics,
    )) {
      this.dashboard.register({
        metric,
        resolveAll: (cards) => this.resolve(column, cards),
      });
    }
  }
  protected async resolve(
    column: (typeof QualityNumericCatalog.metrics)[keyof typeof QualityNumericCatalog.metrics]["column"],
    cards: DashboardResolvable[],
  ) {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();
    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project || entry.scope.projects.length !== 1) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const { branch } = qualityNumericFiltersSchema.parse(entry.filters);
      const pair = await this.quality.closedDays(
        project.id,
        branch,
        entry.evaluatedAt,
      );
      const detail = {
        branch,
        day: pair.day,
        previous_day: pair.previousDay,
        ...(pair.current
          ? {
              commit_sha: pair.current.commitSha,
              updated_at: pair.current.updatedAt,
            }
          : {}),
        ...(pair.previous
          ? {
              previous: pair.previous[column],
              previous_commit_sha: pair.previous.commitSha,
              previous_updated_at: pair.previous.updatedAt,
            }
          : {}),
      };
      out.set(entry.card.id, {
        ...(pair.current
          ? { value: pair.current[column] }
          : { empty: "noData" as const }),
        ...(column.startsWith("coverage") ? { unit: "percent" as const } : {}),
        detail,
        link: {
          route: "reportsQuality",
          params: { projectSlug: project.slug ?? "" },
          query: { branch },
        },
      });
    }
    return out;
  }
}
