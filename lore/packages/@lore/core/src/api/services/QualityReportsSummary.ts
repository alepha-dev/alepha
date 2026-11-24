import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { qualityRuns } from "../entities/qualityRuns.ts";
import type { ReportsQuery } from "../schemas/reportsQuerySchema.ts";
import { ReportsSummaryRegistry } from "./ReportsSummaryRegistry.ts";

/**
 * Quality's line of the Reports Summary tab: line coverage of the latest run
 * in the period, moved from Ship's summary with Quality (#E162).
 */
export class QualityReportsSummary {
  protected readonly summary = $inject(ReportsSummaryRegistry);
  protected readonly quality = $repository(qualityRuns);

  constructor() {
    this.summary.register({
      capability: "reports",
      option: "quality",
      read: (projectId, query) => this.read(projectId, query),
    });
  }

  protected async read(projectId: number, query: ReportsQuery) {
    const coverage = await this.coverage(projectId, query);
    return coverage === undefined
      ? []
      : [
          {
            key: "coverage",
            value: coverage,
            format: "percent" as const,
            upIsGood: true,
            tab: "reportsQuality",
          },
        ];
  }

  /**
   * Line coverage of the latest run in the period.
   */
  protected async coverage(
    projectId: number,
    query: ReportsQuery,
  ): Promise<number | undefined> {
    const [latest] = await this.quality.findMany({
      where: {
        projectId: { eq: projectId },
        ...(query.from || query.to
          ? {
              day: {
                ...(query.from ? { gte: query.from.slice(0, 10) } : {}),
                ...(query.to ? { lte: query.to.slice(0, 10) } : {}),
              },
            }
          : {}),
      },
      orderBy: { column: "day", direction: "desc" },
      limit: 1,
      columns: ["coverageLines"],
    });
    return latest?.coverageLines;
  }
}
