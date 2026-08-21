/**
 * The aggregates a dataset can be asked for.
 *
 * `sum` alone. It is both mergeable across buckets (summing two `sum`s
 * produces the correct total for their union — the fold `rollup()` performs,
 * and the fold a hot/cold merge performs, are the same operation) and exactly
 * correctable under sampling: `sum(x * _sample_interval)` reconstructs the
 * true total from a sampled window. An app that wants a row count declares a
 * measure that is `1` per event and sums it — that is a `sum`, not a separate
 * aggregate, and it survives a rollup and a sampled backend for the same
 * reason any other `sum` does.
 *
 * `count` used to be a second aggregate here, implemented as the number of
 * *stored rows* — `COUNT(*)` relationally, `+1` per array entry in memory.
 * That is not the same number on every backend (a relational upsert
 * accumulates multiple writes into one row; an in-memory push does not), and
 * it does not survive `rollup()` on any backend: folding rows collapses the
 * very thing being counted, so a `count` taken before a rollup and the same
 * `count` taken after disagree. Both failures are the same category this
 * type excludes `min`/`max` for — an aggregate has to be correct after a
 * rollup and identical across backends, not just individually plausible on
 * one of them — so `count` was removed rather than fixed.
 *
 * `avg` and percentiles are absent for a mergeability reason: the mean of two
 * means is wrong when the buckets differ in size, and the p75 of two
 * distributions is not the mean of their p75s. An app wanting a mean declares
 * a sum measure and a count-as-sum measure (see above) and divides; an app
 * wanting a percentile makes the histogram bucket a dimension and walks the
 * result. Both stay caller-side and obvious, and no merge-rule enforcement
 * layer has to exist.
 *
 * `min` and `max` are absent for a *different* reason: they merge across
 * buckets by construction, but they are not sample-correctable. If Analytics
 * Engine drops the row holding the true extreme, no `_sample_interval`
 * weighting reconstructs it — the query silently returns the extreme of
 * whatever survived. That is the same failure mode that excludes
 * distinct-counts from this seam; admitting min/max despite it would be
 * inconsistent.
 */
export type AnalyticsAggregate = "sum";

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
  select: Record<string, AnalyticsAggregate>;
  orderBy?: { key: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface AnalyticsResult {
  rows: Array<Record<string, string | number>>;

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
