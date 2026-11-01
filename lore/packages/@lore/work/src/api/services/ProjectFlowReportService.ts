import { ReportStatistics } from "@lore/core/api";
import type { ReportsFlow, ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, type PgQueryWhere } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";
import { QuestFlowService } from "./QuestFlowService.ts";
import { QuestHoldTime } from "./QuestHoldTime.ts";

/**
 * The Flow tab's report (#Q3000): how work moved through the period, on top of
 * `ProjectReportsService`'s scope and `QuestFlowService`'s history.
 *
 * Medians and p85 throughout, never means; hold time is out of cycle time, and
 * stays in lead time, which is what the requester waited.
 */
export class ProjectFlowReportService {
  protected readonly quests = $repository(quests);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly flow = $inject(QuestFlowService);
  protected readonly series = $inject(DashboardFlowSeries);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly holdTime = $inject(QuestHoldTime);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * The upper edge of each histogram bucket, in hours. The last one is open.
   */
  protected readonly edges: Array<[key: string, hours: number]> = [
    ["under1h", 1],
    ["under4h", 4],
    ["under1d", 24],
    ["under3d", 72],
    ["under1w", 168],
    ["under2w", 336],
    ["under4w", 672],
    ["over4w", Number.POSITIVE_INFINITY],
  ];

  async report(projectId: number, query: ReportsQuery): Promise<ReportsFlow> {
    const to = query.to ?? this.dt.nowISOString();
    const from = query.from ?? this.dt.now().subtract(90, "day").toISOString();
    const axis = this.series.between(from, to);
    const grain = query.grain ?? this.series.grainFor(axis.length);
    const scope = await this.reports.scopeOf(projectId, query);

    const [overview, completed, cumulative, columns] = await Promise.all([
      this.reports.overview(projectId, query),
      this.closed(scope, query),
      this.flow.points(
        projectId,
        this.series
          .sampled(
            axis.map((at) => ({ at })),
            grain,
          )
          .map((point) => point.at),
        query,
      ),
      this.flow.columnTimes(projectId, query),
    ]);

    const cycle = completed.map((row) => row.cycleHours);
    const lead = completed.map((row) => row.leadHours);
    const cycleP50Hours = this.stats.median(cycle);
    const cycleP85Hours = this.stats.percentile(cycle, 85);

    return {
      period: overview.period,
      ...(overview.previous ? { previous: overview.previous } : {}),
      wip: overview.kpis.openQuests,
      grain,
      throughput: this.throughput(
        await this.reports.createdByDay(projectId, query),
        await this.reports.completedByDay(projectId, query),
        axis,
        grain,
      ),
      cumulative,
      scatter: completed
        .toSorted((a, b) => b.date.localeCompare(a.date))
        .slice(0, 500)
        .map((row) => ({
          shortId: row.shortId,
          title: row.title,
          date: row.date,
          hours: row.cycleHours,
        })),
      cycleP50Hours,
      cycleP85Hours,
      leadP50Hours: this.stats.median(lead),
      leadP85Hours: this.stats.percentile(lead, 85),
      cycleHistogram: this.histogram(cycle),
      leadHistogram: this.histogram(lead),
      aging: await this.aging(scope, query, cycleP50Hours, cycleP85Hours),
      hold: this.hold(completed.map((row) => row.heldHours)),
      columns,
    };
  }

  /**
   * Created and completed per bucket of the axis, with what they add up to.
   */
  protected throughput(
    created: Array<{ date: string; count: number }>,
    completed: Array<{ date: string; count: number }>,
    axis: string[],
    grain: ReportsFlow["grain"],
  ): ReportsFlow["throughput"] {
    const buckets = new Map<string, { created: number; completed: number }>();
    for (const day of axis) {
      buckets.set(this.series.bucket(day, grain), { created: 0, completed: 0 });
    }
    const add = (
      rows: Array<{ date: string; count: number }>,
      key: "created" | "completed",
    ) => {
      for (const row of rows) {
        const bucket = buckets.get(this.series.bucket(row.date, grain));
        if (bucket) {
          bucket[key] += Number(row.count);
        }
      }
    };
    add(created, "created");
    add(completed, "completed");

    const done: number[] = [];
    return [...buckets.entries()].map(([date, bucket]) => {
      done.push(bucket.completed);
      return {
        date,
        ...bucket,
        rollingMedian: this.stats.median(done.slice(-4)),
        net: bucket.created - bucket.completed,
      };
    });
  }

  /**
   * Every quest completed in the period, with its times. `history` is read
   * only for the quests that hold a `held` event.
   */
  protected async closed(
    scope: PgQueryWhere<typeof quests.schema>,
    query: ReportsQuery,
  ) {
    const where = {
      ...scope,
      acceptedAt: { isNotNull: true },
      completedAt: {
        isNotNull: true as const,
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      },
    };
    const [rows, heldRows] = await Promise.all([
      this.quests.findMany({
        where,
        columns: [
          "id",
          "shortId",
          "title",
          "createdAt",
          "acceptedAt",
          "completedAt",
        ],
      }),
      this.quests.findMany({
        where: { ...where, history: { like: '%"held"%' } } as typeof where,
        columns: ["id", "history"],
      }),
    ]);
    const historyOf = new Map(heldRows.map((row) => [row.id, row.history]));

    return rows.map((row) => {
      const created = this.dt.of(row.createdAt).valueOf();
      const accepted = this.dt.of(row.acceptedAt!).valueOf();
      const done = this.dt.of(row.completedAt!).valueOf();
      const held = this.holdTime.within(
        historyOf.get(row.id) ?? [],
        accepted,
        done,
      );
      return {
        shortId: row.shortId,
        title: row.title,
        date: row.completedAt!.slice(0, 10),
        cycleHours: Math.max(done - accepted - held, 0) / 3_600_000,
        leadHours: Math.max(done - created, 0) / 3_600_000,
        heldHours: held / 3_600_000,
      };
    });
  }

  protected histogram(hours: number[]): ReportsFlow["cycleHistogram"] {
    const counts = new Map(this.edges.map(([key]) => [key, 0]));
    for (const value of hours) {
      const [key] = this.edges.find(([, edge]) => value < edge) ?? ["over4w"];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => ({ key, count }));
  }

  /**
   * The oldest quests in progress, against what got completed: a quest past
   * p85 is already older than nearly everything that ever finished.
   */
  protected async aging(
    scope: PgQueryWhere<typeof quests.schema>,
    query: ReportsQuery,
    p50Hours: number,
    p85Hours: number,
  ): Promise<ReportsFlow["aging"]> {
    const rows = await this.quests.findMany({
      where: {
        ...scope,
        acceptedAt: { isNotNull: true },
        completedAt: { isNull: true },
        heldAt: { isNull: true },
      },
      columns: ["shortId", "title", "acceptedAt"],
      orderBy: { column: "acceptedAt", direction: "asc" },
      limit: query.agingLimit ?? 50,
    });
    const now = this.dt.nowMillis();
    return rows.map((row) => {
      const hours = (now - this.dt.of(row.acceptedAt!).valueOf()) / 3_600_000;
      return {
        shortId: row.shortId,
        title: row.title,
        ageDays: hours / 24,
        band:
          hours <= p50Hours
            ? ("under_p50" as const)
            : hours <= p85Hours
              ? ("under_p85" as const)
              : ("over_p85" as const),
      };
    });
  }

  protected hold(heldHours: number[]): ReportsFlow["hold"] {
    const held = heldHours.filter((hours) => hours > 0);
    return {
      quests: held.length,
      medianHours: this.stats.median(held),
      p85Hours: this.stats.percentile(held, 85),
    };
  }
}
