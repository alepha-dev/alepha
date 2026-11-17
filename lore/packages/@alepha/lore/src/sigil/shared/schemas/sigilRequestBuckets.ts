/**
 * Fixed histogram buckets for server request durations, in milliseconds
 * (#Q3777), the way {@link VITALS_BUCKETS} are for web vitals: a percentile is
 * read from bucket counts alone, with no raw sample stored.
 *
 * Doubling from 25 ms: fine where an API is fast, coarse where it is already
 * too slow to care by how much. A duration above the last boundary lands in
 * the overflow bucket, `REQUEST_BUCKETS.length`.
 *
 * ⚠️ Append only. A stored row carries a bucket INDEX, so inserting a
 * boundary would move every row above it.
 */
export const REQUEST_BUCKETS: number[] = [
  25, 50, 100, 200, 400, 800, 1600, 3200, 6400,
];

/**
 * The status classes a request is folded under: what an API-latency
 * requirement reads (`2xx`) and what it leaves out.
 */
export const REQUEST_STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;
export type RequestStatusClass = (typeof REQUEST_STATUS_CLASSES)[number];

export const requestBucketIndex = (durationMs: number): number => {
  for (let i = 0; i < REQUEST_BUCKETS.length; i++) {
    if (durationMs <= REQUEST_BUCKETS[i]) return i;
  }
  return REQUEST_BUCKETS.length; // overflow
};

/**
 * A status code's class, `5xx` for anything out of range: a response that
 * claims no sane status failed.
 */
export const requestStatusClass = (status: number): RequestStatusClass => {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  return "5xx";
};
