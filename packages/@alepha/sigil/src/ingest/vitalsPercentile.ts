import {
  VITALS_BUCKETS,
  type VitalMetric,
} from "../shared/schemas/sigilVitalsBuckets.ts";
import type { AnalyticsVitalHistograms } from "./AnalyticsStore.ts";

/**
 * Walk a bucket histogram to the 75th percentile.
 *
 * Returns the **upper boundary** of the bucket the percentile falls in. A
 * sample that overflowed every boundary has no upper bound to report, so the
 * last boundary is returned as a conservative floor: the honest reading is
 * "at least this bad", never "exactly this".
 *
 * Lives in the package rather than in whichever app happens to render the
 * chart, because every {@link AnalyticsStore} implementation returns histograms
 * and none of them should be re-deriving this. Merging has to happen at the
 * bucket level anyway — the p75 of two distributions is not the mean of their
 * p75s — so a store that returns per-app percentiles could not be merged at all.
 */
export const vitalsP75 = (
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
      return boundaries[Math.min(index, boundaries.length - 1)];
    }
  }
  return boundaries[boundaries.length - 1];
};

/** p75 for all five metrics, `null` where the window saw no sample. */
export interface VitalsP75Summary {
  /** Largest Contentful Paint, ms. */
  lcp: number | null;
  /** Cumulative Layout Shift, unitless — already un-scaled. */
  cls: number | null;
  /** Interaction to Next Paint, ms. */
  inp: number | null;
  /** First Contentful Paint, ms. */
  fcp: number | null;
  /** Time to First Byte, ms. */
  ttfb: number | null;
}

/**
 * Every metric's p75, from the histograms a store returned.
 *
 * CLS is divided back down by 1000 here. The browser collector scales it to an
 * integer before bucketing so the boundaries stay free of float drift, and
 * undoing that is the kind of detail every consumer would otherwise have to
 * remember — one of them eventually would not.
 */
export const summariseVitals = (
  histograms: AnalyticsVitalHistograms,
): VitalsP75Summary => {
  const p75 = (metric: VitalMetric) => vitalsP75(histograms[metric], metric);
  const cls = p75("cls");
  return {
    lcp: p75("lcp"),
    cls: cls === null ? null : cls / 1000,
    inp: p75("inp"),
    fcp: p75("fcp"),
    ttfb: p75("ttfb"),
  };
};
