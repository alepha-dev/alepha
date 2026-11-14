import { ReportsSummaryRegistry } from "@lore/core/api";
import type { ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { releases } from "../entities/releases.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * Plan's lines of the Reports Summary tab (#Q2999), Feedback's under the
 * `plan.feedback` option.
 */
export class WorkReportsSummary {
  protected readonly summary = $inject(ReportsSummaryRegistry);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);
  protected readonly feedback = $repository(feedback);

  constructor() {
    this.summary.register({
      capability: "plan",
      read: (projectId, query) => this.work(projectId, query),
    });
    this.summary.register({
      capability: "plan",
      option: "feedback",
      read: (projectId, query) => this.support(projectId, query),
    });
  }

  /**
   * A where-filter over a period, or nothing for an unbounded one: an empty
   * operator object is not a filter.
   */
  protected within(query: ReportsQuery) {
    return {
      isNotNull: true as const,
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  protected async work(projectId: number, query: ReportsQuery) {
    const [overview, epicsShipped, releasesShipped] = await Promise.all([
      this.reports.overview(projectId, { ...query, compare: false }),
      this.epics.count({
        projectId: { eq: projectId },
        completedAt: this.within(query),
      }),
      this.releases.count({
        projectId: { eq: projectId },
        releasedAt: this.within(query),
      }),
    ]);
    const tab = "reportsFlow";
    return [
      {
        key: "throughput",
        value: overview.period.completed,
        format: "count" as const,
        upIsGood: true,
        tab,
      },
      {
        key: "cycleTime",
        value: overview.period.medianCycleTimeHours,
        format: "hours" as const,
        upIsGood: false,
        tab,
      },
      {
        key: "wip",
        value: overview.kpis.openQuests,
        format: "count" as const,
        snapshot: true,
        tab,
      },
      {
        key: "epicsShipped",
        value: epicsShipped,
        format: "count" as const,
        upIsGood: true,
        tab: "reportsPlanning",
      },
      {
        key: "releasesShipped",
        value: releasesShipped,
        format: "count" as const,
        upIsGood: true,
        tab: "reportsPlanning",
      },
    ];
  }

  protected async support(projectId: number, query: ReportsQuery) {
    const [received, triaged, pending] = await Promise.all([
      this.feedback.count({
        projectId: { eq: projectId },
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      }),
      this.feedback.count({
        projectId: { eq: projectId },
        triagedAt: this.within(query),
      }),
      this.feedback.count({
        projectId: { eq: projectId },
        status: { eq: "pending" },
      }),
    ]);
    const tab = "reportsSupport";
    return [
      { key: "feedbackIn", value: received, format: "count" as const, tab },
      {
        key: "feedbackTriaged",
        value: triaged,
        format: "count" as const,
        upIsGood: true,
        tab,
      },
      {
        key: "feedbackPending",
        value: pending,
        format: "count" as const,
        snapshot: true,
        tab,
      },
    ];
  }
}
