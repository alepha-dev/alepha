import { ReportsSummaryRegistry } from "@lore/core/api";
import type { ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { blights } from "../entities/blights.ts";
import { deployments } from "../entities/deployments.ts";
import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { monitors } from "../entities/monitors.ts";
import { qualityRuns } from "../entities/qualityRuns.ts";

/**
 * Apps' lines of the Reports Summary tab (#Q2999).
 *
 * Uptime is computed from `monitor_incidents`, the exact outage boundaries,
 * rather than from the probes dataset: that one is sampled, and read per
 * monitor.
 */
export class DeployReportsSummary {
  protected readonly summary = $inject(ReportsSummaryRegistry);
  protected readonly deployments = $repository(deployments);
  protected readonly blights = $repository(blights);
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly quality = $repository(qualityRuns);
  protected readonly dt = $inject(DateTimeProvider);

  constructor() {
    this.summary.register({
      capability: "apps",
      read: (projectId, query) => this.read(projectId, query),
    });
  }

  protected async read(projectId: number, query: ReportsQuery) {
    const within = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
    const period = query.from || query.to ? { createdAt: within } : {};
    const [finished, succeeded, openBlights, coverage, uptime] =
      await Promise.all([
        this.deployments.count({
          projectId: { eq: projectId },
          status: { inArray: ["succeeded", "failed"] },
          ...period,
        }),
        this.deployments.count({
          projectId: { eq: projectId },
          status: { eq: "succeeded" },
          ...period,
        }),
        this.blights.count({
          projectId: { eq: projectId },
          status: { eq: "open" },
        }),
        this.coverage(projectId, query),
        this.uptime(projectId, query),
      ]);

    const tab = "reportsDelivery";
    return [
      {
        key: "deploys",
        value: finished,
        format: "count" as const,
        upIsGood: true,
        tab,
      },
      ...(finished > 0
        ? [
            {
              key: "deploySuccess",
              value: (succeeded / finished) * 100,
              format: "percent" as const,
              upIsGood: true,
              tab,
            },
          ]
        : []),
      {
        key: "openBlights",
        value: openBlights,
        format: "count" as const,
        snapshot: true,
        tab,
      },
      ...(uptime === undefined
        ? []
        : [
            {
              key: "uptime",
              value: uptime,
              format: "percent" as const,
              upIsGood: true,
              tab,
            },
          ]),
      ...(coverage === undefined
        ? []
        : [
            {
              key: "coverage",
              value: coverage,
              format: "percent" as const,
              upIsGood: true,
              tab,
            },
          ]),
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

  /**
   * The share of monitor time not inside an incident, over the period. Nothing
   * without a period to divide by or a monitor to read.
   */
  protected async uptime(
    projectId: number,
    query: ReportsQuery,
  ): Promise<number | undefined> {
    if (!query.from) {
      return undefined;
    }
    const watched = await this.monitors.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    if (watched.length === 0) {
      return undefined;
    }
    const from = this.dt.of(query.from).valueOf();
    const to = query.to ? this.dt.of(query.to).valueOf() : this.dt.nowMillis();
    const incidents = await this.incidents.findMany({
      where: {
        monitorId: { inArray: watched.map((it) => it.id) },
        startedAt: { lte: new Date(to).toISOString() },
      },
      columns: ["startedAt", "endedAt"],
    });
    const down = incidents.reduce((sum, incident) => {
      const start = this.dt.of(incident.startedAt).valueOf();
      const end = incident.endedAt
        ? this.dt.of(incident.endedAt).valueOf()
        : to;
      return sum + Math.max(Math.min(end, to) - Math.max(start, from), 0);
    }, 0);
    return (1 - down / (watched.length * (to - from))) * 100;
  }
}
