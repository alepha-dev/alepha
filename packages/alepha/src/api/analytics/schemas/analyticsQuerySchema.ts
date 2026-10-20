/**
 * How a measure's values combine inside a bucket, and across buckets when a
 * rollup or a cross-tier read merges them.
 *
 * Every fold here survives a rollup: the total, extreme or latest value of
 * two buckets is computed from theirs alone, so a number the UI shows does
 * not change when hours fold into days; only the time axis coarsens.
 *
 * - `sum`: counters (validations per hour). The only fold a sampled backend
 *   can reconstruct: `sum(x * _sample_interval)` corrects a sampled window.
 *   A row count is a measure that is `1` per event, summed. A mean is a sum
 *   measure divided by a count-as-sum measure, caller-side.
 * - `min`, `max`: gauges (temperature, cash level). Mergeable, but not
 *   sample-correctable: if Analytics Engine drops the row holding the
 *   extreme, nothing reconstructs it. A dataset declaring them is refused at
 *   boot on a backend that samples (`AnalyticsProvider.exact`).
 * - `last`: the reading with the latest `at` in the bucket; equal `at`
 *   keeps the larger value, so every backend agrees. Refused on sampled
 *   backends for the same reason as `min`/`max`.
 *
 * `count` (stored rows) was removed because it is not the same number on
 * every backend and does not survive a rollup. `avg` and percentiles are
 * absent because the mean of two means and the p75 of two p75s are wrong;
 * a percentile is modelled with the histogram bucket as a dimension.
 */
export type AnalyticsFold = "sum" | "min" | "max" | "last";

/**
 * Dimension filters. Only equality and set membership — no ranges.
 */
export type AnalyticsFilter = Record<
  string,
  string | number | { inArray: Array<string | number> }
>;

export interface AnalyticsQuery {
  where?: AnalyticsFilter;
  /**
   * First UTC day included, `YYYY-MM-DD`.
   */
  since: string;
  /**
   * Last UTC day included, `YYYY-MM-DD`. Omitted means "up to the newest
   * bucket there is", which is what every caller wanted before this existed.
   *
   * Inclusive, and a *day* rather than an hour: the bucket key is
   * `YYYY-MM-DDTHH` with the day as its prefix, so both bounds are the same
   * kind of thing and neither needs date arithmetic to compare. Days are also
   * the only granularity a rolled-up bucket can still honour.
   *
   * Its reason for existing is comparison. A window that ends "now" ends
   * mid-day, so measuring it against a complete one reads as a collapse every
   * morning and recovers by evening — the number moves because the clock
   * moved, not because anything happened. Bounding the top end is what makes
   * "yesterday against the day before" a statement about traffic.
   */
  until?: string;
  /**
   * Declared dimension names, plus the pseudo-dimensions `hour` and `day`.
   */
  groupBy?: string[];
  /**
   * The fold to read for each measure. A single fold returns the measure's
   * own name as the key (`{ temperature: "max" }` returns `temperature`); an
   * array returns one key per fold, `<measure>_<fold>`
   * (`{ temperature: ["min", "max", "last"] }` returns `temperature_min`,
   * `temperature_max`, `temperature_last`), which is what a band chart needs
   * in one round trip. A fold the measure does not declare is refused.
   */
  select: Record<string, AnalyticsFold | AnalyticsFold[]>;
  /**
   * `key` is a grouped dimension or a returned measure key, in either form.
   */
  orderBy?: { key: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface AnalyticsResult {
  /**
   * A gauge fold over buckets that hold no reading comes back `null`.
   */
  rows: Array<Record<string, string | number | null>>;

  /**
   * Whether these numbers are reconstructed rather than measured.
   *
   * `false` on relational and memory backends, `true` on Analytics Engine,
   * which samples. On the result rather than on the provider so that a UI
   * ignoring it is a visible choice rather than an accident.
   */
  estimated: boolean;

  /**
   * The largest `_sample_interval` seen in the window, when the backend
   * samples. `1` means no sampling occurred and the numbers are exact despite
   * `estimated` being `true` — the common case at low traffic, and worth
   * telling a UI so it can drop the qualifier.
   */
  sampleInterval?: number;
}
