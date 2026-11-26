import { VITALS_THRESHOLDS, type VitalMetric } from "@alepha/lore/sigil";
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

import { appInstances } from "../entities/appInstances.ts";
import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";
import type { VitalsMetricResource } from "../schemas/vitalsMetricSchema.ts";
import {
  type AnalyticsVitalHistograms,
  summariseVitalMetric,
} from "../vitalsPercentile.ts";

/**
 * How fast an app copy's pages feel (#Q4521): the p75 of LCP, INP and CLS
 * over the board's window, one pill each, as the Vitals page reads them.
 *
 * - **A range, never a number**: the store holds bucket counts, so a p75 is
 *   the bucket it falls in (`summariseVitalMetric`), shown as its range.
 * - **The tone is the bucket's rating** against `VITALS_THRESHOLDS`, the
 *   page's own: good, needs improvement, poor.
 * - **Few samples are not a measurement**: under 30 the pill stays neutral
 *   and says how many there were, the Vitals page's rule (#Q1295).
 * - **Beacon apps only**: vitals come with the beacon, and the Vitals page of
 *   a beacon-less copy 404s, so neither is measured nor linked.
 *
 * Empty when no copy in scope reported a vital in the window.
 */
export class WebVitalsMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "webVitals";

  /**
   * The metrics the tile shows, in order.
   */
  public static readonly METRICS: readonly VitalMetric[] = [
    "lcp",
    "inp",
    "cls",
  ];

  /**
   * Below this many samples a p75 is a hint, not a measurement: the Vitals
   * page's `MIN_SAMPLES`.
   */
  public static readonly MIN_SAMPLES = 30;

  protected readonly sigils = $repository(sigils);
  protected readonly instances = $repository(appInstances);
  protected readonly datasets = $inject(DeployAnalytics);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly catalog = $inject(DashboardMetricCatalog);

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
      out.set(entry.card.id, await this.resolveOne(entry));
    }
    return out;
  }

  protected async resolveOne(
    entry: DashboardResolvable,
  ): Promise<Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">> {
    const apps = await this.scopedApps(entry);
    const beacons = apps.filter((sigil) => sigil.kinds?.includes("beacon"));
    if (beacons.length === 0) {
      return { empty: apps.length === 0 ? "noSigil" : "noBeacon", detail: {} };
    }
    const days = Math.max(1, entry.windowDays);
    const until = new Date(this.dateTime.nowMillis());
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const result = await this.datasets.vitals.query({
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
      where: { sigilId: { inArray: beacons.map((it) => it.id) } },
      groupBy: ["metric", "bucket"],
      select: { samples: "sum" },
    });
    const histograms: AnalyticsVitalHistograms = {};
    for (const row of result.rows) {
      const metric = row.metric as VitalMetric;
      const buckets = histograms[metric] ?? new Map<number, number>();
      buckets.set(Number(row.bucket), Number(row.samples));
      histograms[metric] = buckets;
    }
    const summaries = WebVitalsMetric.METRICS.map((metric) => ({
      metric,
      data: summariseVitalMetric(histograms[metric], metric),
    }));
    if (summaries.every((it) => it.data.samples === 0)) {
      return { empty: "noData", detail: {} };
    }
    const project = entry.scope.projects.find(
      (it) => it.id === beacons[0]!.projectId,
    );
    const instance = await this.instances.findOne({
      where: {
        projectId: { eq: beacons[0]!.projectId },
        sigilId: { eq: beacons[0]!.id },
      },
    });
    // The first beacon copy's Vitals page, as the visitors tile links its
    // analytics: there is no cross-copy one.
    const link = this.catalog.get(this.metric).link(entry.card.scope, {
      projectSlug: project?.slug,
      app: instance?.app,
      env: instance?.env,
    });
    const rows = summaries.map(({ metric, data }) => ({
      id: `${metric.toUpperCase()} ${WebVitalsMetric.rangeText(metric, data)}`,
      title: metric.toUpperCase(),
      state: WebVitalsMetric.stateOf(metric, data),
      // Rows with a link give the tile its "See all".
      ...(link ? { link } : {}),
    }));
    return {
      value: rows.filter((row) => row.state === "ok").length,
      rows,
      detail: {
        days,
        samples: Object.fromEntries(
          summaries.map(({ metric, data }) => [metric, data.samples]),
        ),
        rated: rows.filter((row) => row.state !== "neutral").length,
      },
      ...(link ? { link } : {}),
    };
  }

  /**
   * A metric's pill tone: its p75 bucket's rating, neutral with too few
   * samples to say.
   */
  public static stateOf(
    metric: VitalMetric,
    data: VitalsMetricResource,
  ): "ok" | "warn" | "bad" | "neutral" {
    if (data.p75Bucket === null || data.samples < WebVitalsMetric.MIN_SAMPLES) {
      return "neutral";
    }
    const scale = metric === "cls" ? 1000 : 1;
    const good = VITALS_THRESHOLDS[metric].good / scale;
    const poor = VITALS_THRESHOLDS[metric].poor / scale;
    // The bucket's ceiling decides, as on the Vitals page: a bucket lies
    // entirely in one band. The overflow bucket has none and is poor.
    const ceiling = data.boundaries[data.p75Bucket];
    if (ceiling === undefined) return "bad";
    if (ceiling <= good) return "ok";
    if (ceiling <= poor) return "warn";
    return "bad";
  }

  /**
   * The p75's range as a pill reads it: `≤ 1.8 s`, `200–500 ms`, `> 4 s`,
   * `≤ 0.1`. Units are the metric's own, never translated.
   */
  public static rangeText(
    metric: VitalMetric,
    data: VitalsMetricResource,
  ): string {
    if (data.p75Lower === null) return "–";
    // The unit rides on the upper bound alone when both share it, as on
    // the Vitals page: `1–1.8 s`, `400–500 ms`.
    const unitOf = (value: number) =>
      metric === "cls" ? "" : value >= 1000 ? " s" : " ms";
    const number = (value: number) => {
      if (metric === "cls") return String(Number(value.toFixed(2)));
      return value >= 1000
        ? String(Number((value / 1000).toFixed(1)))
        : String(Math.round(value));
    };
    const format = (value: number) => `${number(value)}${unitOf(value)}`;
    if (data.p75Upper === null) return `> ${format(data.p75Lower)}`;
    if (data.p75Lower === 0) return `≤ ${format(data.p75Upper)}`;
    const lower =
      unitOf(data.p75Lower) === unitOf(data.p75Upper)
        ? number(data.p75Lower)
        : format(data.p75Lower);
    return `${lower}–${format(data.p75Upper)}`;
  }

  /**
   * The apps this card measures: an `apps` scope names them, a `projects`
   * scope means every app of those projects.
   */
  protected async scopedApps(entry: DashboardResolvable): Promise<Sigil[]> {
    if (entry.scope.sigilIds) {
      return entry.scope.subjects
        .filter((it) => it.kind === "app")
        .map((it) => it.row as Sigil);
    }
    if (entry.scope.projectIds.length === 0) return [];
    return this.sigils.findMany({
      where: { projectId: { inArray: entry.scope.projectIds } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
  }
}
