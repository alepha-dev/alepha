import { REQUEST_BUCKETS, VITALS_BUCKETS } from "@alepha/lore/sigil";
import { ProjectSecurityService } from "@lore/core/api";
import { DeployAnalytics } from "@lore/ship/api";
import { appInstances, monitors } from "@lore/ship/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { requirementMetricDays } from "../entities/requirementMetricDays.ts";
import { type Requirement, requirements } from "../entities/requirements.ts";
import type {
  MetricStatus,
  RequirementMetric,
} from "../schemas/requirementMetricSchema.ts";

/**
 * The value of one evaluation: `value` absent with `no_data`.
 */
export interface MetricEvaluation {
  value?: number;
  status: MetricStatus;
}

/**
 * Metric requirements (#E153, #Q3773): evaluates a requirement's measure
 * from what Ship already stores (`sigil_vitals`, `sigil_requests`,
 * `uptime_probes`) and writes
 * the result on the requirement, so no screen queries the analytics. The
 * hourly job calls {@link evaluateAll}; a save calls {@link evaluateOne}.
 *
 * ⚠️ A monitor's latency percentile is a percentile of its hourly mean
 * latencies, weighted by probe count: `uptime_probes` stores sums, and the
 * individual heartbeats are kept 100 deep, too few for a window of days.
 */
export class RequirementMetricService {
  protected readonly log = $logger();
  protected readonly requirements = $repository(requirements);
  protected readonly days = $repository(requirementMetricDays);
  protected readonly copies = $repository(appInstances);
  protected readonly monitors = $repository(monitors);
  protected readonly analytics = $inject(DeployAnalytics);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Every metric requirement of every project, one at a time: a failure is
   * logged and the next one runs.
   */
  public async evaluateAll(): Promise<number> {
    const rows = await this.requirements.findMany({
      where: { metric: { isNotNull: true } },
    });
    let done = 0;
    for (const row of rows) {
      try {
        await this.evaluateOne(row);
        done += 1;
      } catch (error) {
        this.log.warn("Metric requirement not evaluated", {
          requirementId: row.id,
          error,
        });
      }
    }
    return done;
  }

  /**
   * Evaluate one requirement and store the result: its value, status,
   * `metricStatusSince` (moved only when the status changes, never by "no
   * data"), `metricEvaluatedAt`, and today's row of the sparkline.
   */
  public async evaluateOne(row: Requirement): Promise<Requirement> {
    if (!row.metric) return row;
    const result = await this.evaluate(row.projectId, row.metric);
    const now = this.dt.nowISOString();
    const moved =
      result.status !== "no_data" && result.status !== row.metricStatus;
    const saved = await this.requirements.updateById(row.id, {
      metricValue: result.value ?? null,
      metricStatus: result.status,
      metricEvaluatedAt: now,
      ...(moved || !row.metricStatusSince ? { metricStatusSince: now } : {}),
    } as never);
    const day = now.slice(0, 10);
    const [existing] = await this.days.findMany({
      where: { requirementId: { eq: row.id }, day: { eq: day } },
      limit: 1,
    });
    if (existing) {
      await this.days.updateById(existing.id, {
        value: result.value ?? null,
        status: result.status,
      } as never);
    } else {
      await this.days.create({
        projectId: row.projectId,
        requirementId: row.id,
        day,
        value: result.value,
        status: result.status,
      });
    }
    return saved;
  }

  /**
   * Whether a value meets its threshold: availability at or above it, a
   * vital or a latency at or below it.
   */
  public meets(metric: RequirementMetric, value: number): boolean {
    return metric.kind === "availability"
      ? value >= metric.threshold
      : value <= metric.threshold;
  }

  /**
   * One evaluation, read only. No data when the Ship option the kind needs
   * is off, the copy or monitor is missing, or the window holds no point.
   */
  public async evaluate(
    projectId: number,
    metric: RequirementMetric,
  ): Promise<MetricEvaluation> {
    const capabilities = await this.security.capabilitiesOf(projectId);
    const ship = capabilities.ship;
    const since = this.dt
      .now()
      .subtract(metric.windowDays ?? 7, "day")
      .toISOString();
    const value =
      metric.kind === "vital"
        ? ship?.track
          ? await this.vital(projectId, metric, since)
          : undefined
        : metric.kind === "api"
          ? ship?.track
            ? await this.api(projectId, metric, since)
            : undefined
          : ship?.uptime
            ? await this.monitor(projectId, metric, since)
            : undefined;
    if (value === undefined) return { status: "no_data" };
    return {
      value,
      status: this.meets(metric, value) ? "verified" : "failing",
    };
  }

  protected async copyOf(projectId: number, metric: RequirementMetric) {
    const [copy] = await this.copies.findMany({
      where: {
        projectId: { eq: projectId },
        env: { eq: metric.env ?? "production" },
        ...(metric.app ? { app: { eq: metric.app } } : {}),
      },
      limit: 1,
    });
    return copy;
  }

  /**
   * A path pattern as a test: `*` matches anything, the rest literally.
   */
  protected matchesPath(pattern: string | undefined, path: string): boolean {
    if (!pattern || pattern === "*") return true;
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`).test(path);
  }

  /**
   * The vital at its percentile: the upper boundary of the histogram bucket
   * the percentile lands in (the last boundary for the overflow bucket),
   * unscaled for CLS.
   */
  protected async vital(
    projectId: number,
    metric: RequirementMetric,
    since: string,
  ): Promise<number | undefined> {
    const name = metric.vital ?? "lcp";
    const copy = await this.copyOf(projectId, metric);
    if (!copy?.sigilId) return undefined;
    const result = await this.analytics.vitals.query({
      since,
      where: { sigilId: copy.sigilId, metric: name },
      groupBy: ["path", "bucket"],
      select: { samples: "sum" },
    });
    const histogram = new Map<number, number>();
    for (const row of result.rows) {
      if (!this.matchesPath(metric.path, String(row.path))) continue;
      const bucket = Number(row.bucket);
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + Number(row.samples));
    }
    return this.bucketValue(name, histogram, metric.percentile ?? 75);
  }

  /**
   * An API latency (#Q3777): the percentile of the server's request
   * durations on the routes the pattern matches, from `sigil_requests`.
   * Only `2xx` answers count: a fast error would make a route look faster
   * than it serves.
   */
  protected async api(
    projectId: number,
    metric: RequirementMetric,
    since: string,
  ): Promise<number | undefined> {
    const copy = await this.copyOf(projectId, metric);
    if (!copy?.sigilId) return undefined;
    const method = metric.method?.toUpperCase();
    const result = await this.analytics.requests.query({
      since,
      where: {
        sigilId: copy.sigilId,
        status: "2xx",
        ...(method ? { method } : {}),
      },
      groupBy: ["route", "bucket"],
      select: { samples: "sum" },
    });
    const histogram = new Map<number, number>();
    for (const row of result.rows) {
      if (!this.matchesPath(metric.path, String(row.route))) continue;
      const bucket = Number(row.bucket);
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + Number(row.samples));
    }
    return this.percentileOf(
      REQUEST_BUCKETS,
      histogram,
      metric.percentile ?? 95,
    );
  }

  /**
   * The percentile of a histogram over `boundaries`, as the upper boundary
   * of the bucket it lands in (the last one for the overflow bucket).
   */
  public percentileOf(
    boundaries: number[],
    histogram: Map<number, number>,
    percentile: number,
  ): number | undefined {
    const total = [...histogram.values()].reduce((a, b) => a + b, 0);
    if (total === 0) return undefined;
    const target = Math.ceil((percentile / 100) * total);
    let cumulative = 0;
    for (let index = 0; index <= boundaries.length; index++) {
      cumulative += histogram.get(index) ?? 0;
      if (cumulative >= target) {
        return boundaries[Math.min(index, boundaries.length - 1)];
      }
    }
    return boundaries[boundaries.length - 1];
  }

  /**
   * The percentile of a bucket histogram, as the upper boundary of the
   * bucket it lands in.
   */
  public bucketValue(
    metric: "lcp" | "inp" | "cls",
    histogram: Map<number, number>,
    percentile: number,
  ): number | undefined {
    const value = this.percentileOf(
      VITALS_BUCKETS[metric],
      histogram,
      percentile,
    );
    if (value === undefined) return undefined;
    return metric === "cls" ? value / 1000 : value;
  }

  /**
   * A monitor's availability (percentage of `up` probes) or latency (the
   * percentile of its hourly means).
   */
  protected async monitor(
    projectId: number,
    metric: RequirementMetric,
    since: string,
  ): Promise<number | undefined> {
    const monitorId =
      metric.monitorId ?? (await this.monitorOf(projectId, metric));
    if (!monitorId) return undefined;
    if (metric.kind === "availability") {
      const result = await this.analytics.probes.query({
        since,
        where: { monitorId },
        select: { count: "sum", up: "sum" },
      });
      const count = Number(result.rows[0]?.count ?? 0);
      if (!count) return undefined;
      return (
        Math.round((Number(result.rows[0]?.up ?? 0) / count) * 100_000) / 1000
      );
    }
    const result = await this.analytics.probes.query({
      since,
      where: { monitorId },
      groupBy: ["hour"],
      select: { count: "sum", latencyMs: "sum" },
    });
    const hours = result.rows
      .map((row) => ({
        count: Number(row.count ?? 0),
        mean: Number(row.count) ? Number(row.latencyMs) / Number(row.count) : 0,
      }))
      .filter((it) => it.count > 0)
      .sort((a, b) => a.mean - b.mean);
    return this.weightedPercentile(hours, metric.percentile ?? 95);
  }

  /**
   * The weighted percentile of sorted means.
   */
  public weightedPercentile(
    sorted: Array<{ count: number; mean: number }>,
    percentile: number,
  ): number | undefined {
    const total = sorted.reduce((sum, it) => sum + it.count, 0);
    if (total === 0) return undefined;
    const target = (percentile / 100) * total;
    let cumulative = 0;
    for (const it of sorted) {
      cumulative += it.count;
      if (cumulative >= target) return Math.round(it.mean);
    }
    return Math.round(sorted[sorted.length - 1].mean);
  }

  protected async monitorOf(
    projectId: number,
    metric: RequirementMetric,
  ): Promise<string | undefined> {
    const copy = await this.copyOf(projectId, metric);
    if (!copy) return undefined;
    const [monitor] = await this.monitors.findMany({
      where: { projectId: { eq: projectId }, appInstanceId: { eq: copy.id } },
      columns: ["id"],
      limit: 1,
    });
    return monitor?.id;
  }
}
