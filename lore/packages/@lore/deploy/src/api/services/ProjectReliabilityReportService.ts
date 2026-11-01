import { DeliveryChangeRegistry, ReportStatistics } from "@lore/core/api";
import type { ReportsDelivery, ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { blights } from "../entities/blights.ts";
import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { deployments } from "../entities/deployments.ts";
import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { monitors } from "../entities/monitors.ts";
import { sigils } from "../entities/sigils.ts";

/**
 * The Delivery tab's reliability half (#Q3009): blights, errors and uptime.
 *
 * ⚠️ **A blight has no `resolvedAt`.** `status` is all that moves, so a
 * resolved blight is placed on the day it was last seen, which is the last
 * evidence there is that it was alive. It reads a little early for a blight
 * resolved long after it went quiet. A forwarded one counts as resolved too,
 * since it left the inbox.
 *
 * `name` on a blight is attacker-controlled: it travels as data and the page
 * renders it as text, never as markup.
 */
export class ProjectReliabilityReportService {
  protected readonly blights = $repository(blights);
  protected readonly sigils = $repository(sigils);
  protected readonly deployments = $repository(deployments);
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly datasets = $inject(DeployAnalytics);
  protected readonly changes = $inject(DeliveryChangeRegistry);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly dt = $inject(DateTimeProvider);

  async report(
    projectId: number,
    query: ReportsQuery,
    from: string,
    to: string,
  ): Promise<ReportsDelivery["reliability"]> {
    const axis = this.stats.between(from, to);
    const grain = query.grain ?? this.stats.grainFor(axis.length);
    const [rows, forwarded, errors, uptime] = await Promise.all([
      this.blights.findMany({
        where: { projectId: { eq: projectId } },
        columns: [
          "id",
          "name",
          "origin",
          "count",
          "status",
          "firstSeenAt",
          "lastSeenAt",
        ],
      }),
      this.changes.forwardedBlights(projectId),
      this.errors(projectId, axis, grain),
      this.uptime(projectId, from, to),
    ]);

    const buckets = [
      ...new Set(axis.map((day) => this.stats.bucket(day, grain))),
    ];
    const opened = (at: string) => this.stats.bucket(at.slice(0, 10), grain);
    const isOpen = (status: string) => status === "open";
    const endOf = (index: number) =>
      buckets[index + 1] ?? `${axis.at(-1) ?? ""}￿`;

    const firstSeen = new Map(rows.map((row) => [row.id, row.firstSeenAt]));
    const fixHours = forwarded.flatMap((quest) => {
      const seen = firstSeen.get(quest.blightId);
      return seen && quest.completedAt
        ? [
            (this.dt.of(quest.completedAt).valueOf() -
              this.dt.of(seen).valueOf()) /
              3_600_000,
          ]
        : [];
    });

    return {
      blights: buckets.map((date, index) => ({
        date,
        opened: rows.filter((row) => opened(row.firstSeenAt) === date).length,
        resolved: rows.filter(
          (row) => !isOpen(row.status) && opened(row.lastSeenAt) === date,
        ).length,
        open: rows.filter(
          (row) =>
            row.firstSeenAt < endOf(index) &&
            (isOpen(row.status) || row.lastSeenAt >= endOf(index)),
        ).length,
      })),
      topBlights: rows
        .toSorted((a, b) => b.count - a.count)
        .slice(0, query.top ?? 10)
        .map((row) => ({
          name: row.name,
          origin: row.origin,
          count: row.count,
          status: row.status.startsWith("quest:") ? "forwarded" : row.status,
        })),
      forwarded: {
        total: forwarded.length,
        fixed: fixHours.length,
        medianFixHours: this.stats.median(fixHours),
        p85FixHours: this.stats.percentile(fixHours, 85),
      },
      errors: errors.series,
      deployMarkers: await this.deployMarkers(projectId, from, to, grain),
      monitors: uptime,
    };
  }

  /**
   * Occurrences per bucket, from the dataset rather than the blight rows: a
   * blight holds a running total and could not say when they happened.
   */
  protected async errors(
    projectId: number,
    axis: string[],
    grain: NonNullable<ReportsQuery["grain"]>,
  ): Promise<{ series: Array<{ date: string; count: number }> }> {
    const apps = await this.sigils.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    const buckets = new Map(
      axis.map((day) => [this.stats.bucket(day, grain), 0]),
    );
    if (apps.length > 0 && axis.length > 0) {
      const { rows } = await this.datasets.errors.query({
        since: axis[0]!,
        until: axis.at(-1)!,
        where: { sigilId: { inArray: apps.map((app) => app.id) } },
        groupBy: ["day"],
        select: { count: "sum" },
      });
      for (const row of rows) {
        const key = this.stats.bucket(String(row.day), grain);
        if (buckets.has(key)) {
          buckets.set(key, (buckets.get(key) ?? 0) + Number(row.count));
        }
      }
    }
    return {
      series: [...buckets.entries()].map(([date, count]) => ({ date, count })),
    };
  }

  /**
   * The buckets holding a successful deploy, to set an error spike against.
   */
  protected async deployMarkers(
    projectId: number,
    from: string,
    to: string,
    grain: NonNullable<ReportsQuery["grain"]>,
  ): Promise<string[]> {
    const rows = await this.deployments.findMany({
      where: {
        projectId: { eq: projectId },
        status: { eq: "succeeded" },
        createdAt: { gte: from, lte: to },
      },
      columns: ["createdAt"],
    });
    return [
      ...new Set(
        rows.map((row) => this.stats.bucket(row.createdAt.slice(0, 10), grain)),
      ),
    ];
  }

  protected async uptime(
    projectId: number,
    from: string,
    to: string,
  ): Promise<ReportsDelivery["reliability"]["monitors"]> {
    const watched = await this.monitors.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id", "name"],
    });
    if (watched.length === 0) {
      return [];
    }
    const ids = watched.map((row) => row.id);
    const [probes, incidents] = await Promise.all([
      this.datasets.probes.query({
        since: from.slice(0, 10),
        until: to.slice(0, 10),
        where: { monitorId: { inArray: ids } },
        groupBy: ["monitorId"],
        select: { count: "sum", up: "sum" },
      }),
      this.incidents.findMany({
        where: {
          monitorId: { inArray: ids },
          startedAt: { gte: from, lte: to },
        },
        columns: ["monitorId", "startedAt", "endedAt"],
      }),
    ]);
    const probesOf = new Map(
      probes.rows.map((row) => [
        String(row.monitorId),
        { count: Number(row.count), up: Number(row.up) },
      ]),
    );
    return watched.map((monitor) => {
      const seen = probesOf.get(monitor.id);
      const own = incidents.filter((row) => row.monitorId === monitor.id);
      return {
        name: monitor.name,
        ...(seen?.count ? { uptime: (seen.up / seen.count) * 100 } : {}),
        incidents: own.length,
        mttrMinutes: this.stats.median(
          own.flatMap((row) =>
            row.endedAt
              ? [
                  (this.dt.of(row.endedAt).valueOf() -
                    this.dt.of(row.startedAt).valueOf()) /
                    60_000,
                ]
              : [],
          ),
        ),
      };
    });
  }
}
