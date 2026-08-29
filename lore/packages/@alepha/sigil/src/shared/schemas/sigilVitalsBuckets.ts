/**
 * Fixed histogram buckets per Web Vitals metric, chosen around the
 * good/needs-improvement/poor thresholds with extra granularity so p75 is
 * computable from bucket counts alone (no raw-sample storage).
 *
 * `bucketIndex` returns the index of the first boundary the value is <=; a
 * value above the last boundary maps to the overflow bucket = boundaries.length.
 */
export const METRICS = ["lcp", "cls", "inp", "fcp", "ttfb"] as const;
export type VitalMetric = (typeof METRICS)[number];

export const VITALS_BUCKETS: Record<VitalMetric, number[]> = {
  lcp: [1000, 1800, 2500, 3000, 4000, 6000],
  inp: [100, 200, 300, 400, 500, 800],
  fcp: [800, 1200, 1800, 2400, 3000, 4000],
  ttfb: [200, 400, 600, 800, 1200, 2000],
  // CLS is unitless; the browser collector scales it ×1000 to an int before bucketing.
  cls: [50, 100, 150, 250, 400, 600],
};

/**
 * The standard Web Vitals good / poor p75 thresholds, in the SAME scale as
 * {@link VITALS_BUCKETS}.
 *
 * At or below `good` is good, at or below `poor` needs work, above is poor.
 * CLS is therefore ×1000 here exactly as its buckets are, so the two are
 * comparable without either side remembering to scale: a consumer that
 * un-scales the boundaries un-scales these with them.
 *
 * Here rather than in whichever UI happens to draw a rating, because a sink
 * ranking paths by how much of their traffic lands in a poor bucket has to
 * agree with the card that colours the metric. Two copies of these numbers is
 * two answers to "is this good".
 */
export const VITALS_THRESHOLDS: Record<
  VitalMetric,
  { good: number; poor: number }
> = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  fcp: { good: 1800, poor: 3000 },
  ttfb: { good: 800, poor: 1800 },
  cls: { good: 100, poor: 250 },
};

export const bucketIndex = (metric: VitalMetric, value: number): number => {
  const bounds = VITALS_BUCKETS[metric];
  for (let i = 0; i < bounds.length; i++) {
    if (value <= bounds[i]) return i;
  }
  return bounds.length; // overflow
};
