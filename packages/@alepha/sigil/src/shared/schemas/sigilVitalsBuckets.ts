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

export const bucketIndex = (metric: VitalMetric, value: number): number => {
  const bounds = VITALS_BUCKETS[metric];
  for (let i = 0; i < bounds.length; i++) {
    if (value <= bounds[i]) return i;
  }
  return bounds.length; // overflow
};
