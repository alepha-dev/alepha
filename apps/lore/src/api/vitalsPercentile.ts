import { VITALS_BUCKETS, type VitalMetric } from "@alepha/sigil";

import type { VitalsMetricResource } from "./schemas/vitalsMetricSchema.ts";

/**
 * Bucket index → how many samples, per metric. Absent metrics saw none.
 *
 * Used to live on the now-deleted `AnalyticsStore` interface, which every
 * storage backend implemented `vitalHistograms()` against. Storage moved to
 * `alepha/api/analytics`'s `$analytics()` datasets, but the shape a histogram
 * walk consumes did not change, so it is declared here instead: the one
 * place both {@link vitalsP75Bucket} and its callers need it.
 */
export type AnalyticsVitalHistograms = Partial<
  Record<VitalMetric, Map<number, number>>
>;

/**
 * How much CLS is scaled by on the way in.
 *
 * The browser collector multiplies it to an integer before bucketing so the
 * boundaries stay free of float drift, and undoing that is the kind of detail
 * every consumer would otherwise have to remember - one of them eventually
 * would not. Undone once, here.
 */
const CLS_SCALE = 1000;

/**
 * Walk a bucket histogram to the bucket the 75th percentile falls in.
 *
 * Returns an INDEX, not a value. It used to return the bucket's upper
 * boundary, which is where the tab's invented precision came from: every LCP
 * on the site was one of six round numbers, and the number shown was the
 * ceiling, so a genuinely fast app read as merely acceptable. An index is what
 * the data actually supports, and both the range and the rating are derived
 * from it. See {@link vitalsMetricSchema}.
 *
 * `null` when the window holds no sample. The overflow index
 * (`boundaries.length`) is a real answer, meaning "worse than every boundary",
 * and is deliberately NOT clamped down onto the last bucket the way the old
 * walk clamped its return value.
 *
 * Merging has to happen at the bucket level - the p75 of two distributions is
 * not the mean of their p75s - which is why a backend that returned per-app
 * percentiles could not be merged at all, and why this takes counts.
 */
export const vitalsP75Bucket = (
  histogram: Map<number, number> | undefined,
  metric: VitalMetric,
): number | null => {
  if (!histogram || histogram.size === 0) {
    return null;
  }

  let total = 0;
  for (const count of histogram.values()) {
    total += count;
  }
  if (total === 0) {
    return null;
  }

  const boundaries = VITALS_BUCKETS[metric];
  const target = Math.ceil(0.75 * total);
  let cumulative = 0;
  for (let index = 0; index <= boundaries.length; index++) {
    cumulative += histogram.get(index) ?? 0;
    if (cumulative >= target) {
      return index;
    }
  }
  return boundaries.length;
};

/**
 * Every metric's distribution and p75 bucket, from the histograms a store
 * returned.
 *
 * A metric the window saw nothing for still gets a full entry - zero samples,
 * zero counts, its real boundaries, a null bucket. Absent and empty are
 * different claims, and only the second one lets a UI say "no interaction
 * samples yet" for INP rather than rendering a blank card. INP is empty for
 * four of seven production apps, which is expected rather than broken: it
 * needs a real interaction to exist at all.
 */
export const summariseVitals = (
  histograms: AnalyticsVitalHistograms,
): VitalsSummary => {
  const summary = {} as VitalsSummary;
  for (const metric of Object.keys(VITALS_BUCKETS) as VitalMetric[]) {
    summary[metric] = summariseVitalMetric(histograms[metric], metric);
  }
  return summary;
};

/**
 * One metric's histogram, turned into what the payload carries.
 */
export const summariseVitalMetric = (
  histogram: Map<number, number> | undefined,
  metric: VitalMetric,
): VitalsMetricResource => {
  const scale = metric === "cls" ? CLS_SCALE : 1;
  const boundaries = VITALS_BUCKETS[metric].map((value) => value / scale);
  // One slot per boundary plus the overflow bucket, so a chart can be drawn
  // straight off the array without the caller knowing which end is which.
  const buckets = Array.from(
    { length: boundaries.length + 1 },
    (_, index) => histogram?.get(index) ?? 0,
  );
  const samples = buckets.reduce((total, count) => total + count, 0);
  const p75Bucket = vitalsP75Bucket(histogram, metric);

  return {
    samples,
    buckets,
    boundaries,
    p75Bucket,
    // The previous boundary, or zero for the first bucket: a value in bucket 0
    // is somewhere between nothing and the first boundary, and saying "0 to
    // 1000 ms" is the honest width of that.
    p75Lower: p75Bucket === null ? null : (boundaries[p75Bucket - 1] ?? 0),
    // Absent for the overflow bucket, which has no ceiling to name. "Worse
    // than the last boundary" is the whole answer there, and inventing one
    // would be the same lie in a new place.
    p75Upper: p75Bucket === null ? null : (boundaries[p75Bucket] ?? null),
  };
};

/**
 * Every metric's distribution, `samples: 0` where the window saw nothing.
 */
export interface VitalsSummary {
  /**
   * Largest Contentful Paint, ms.
   */
  lcp: VitalsMetricResource;
  /**
   * Cumulative Layout Shift, unitless. Already un-scaled.
   */
  cls: VitalsMetricResource;
  /**
   * Interaction to Next Paint, ms.
   */
  inp: VitalsMetricResource;
  /**
   * First Contentful Paint, ms.
   */
  fcp: VitalsMetricResource;
  /**
   * Time to First Byte, ms.
   */
  ttfb: VitalsMetricResource;
}
