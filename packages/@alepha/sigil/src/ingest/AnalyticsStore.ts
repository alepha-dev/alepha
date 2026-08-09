import type { VitalMetric } from "../shared/schemas/sigilVitalsBuckets.ts";

/**
 * One page view, as recorded.
 *
 * `hour` rather than a timestamp because nothing reads finer than an hour, and
 * a bucket key is what both storage strategies want: the orm backend upserts a
 * counter keyed on it, and Analytics Engine writes it as a blob it can group
 * by later.
 */
export interface AnalyticsViewSample {
  sigilId: string;
  /** UTC hour bucket, `YYYY-MM-DDTHH`. */
  hour: string;
  /** Page path, query and fragment already stripped. */
  path: string;
  /** Coarse ISO-3166 country from the edge; `ZZ` when unknown. */
  country: string;
  /** How many views this sample stands for. Batches arrive pre-folded. */
  count: number;
}

/**
 * One visitor, once, on one day, for one app.
 *
 * The hash is cookieless and salted per UTC day — see the `sigil_uniques_daily`
 * entity for why that construction is the whole basis for treating these rows
 * as aggregate rather than personal data.
 */
export interface AnalyticsUniqueSample {
  sigilId: string;
  /** UTC day bucket, `YYYY-MM-DD`. */
  day: string;
  visitorHash: string;
}

/**
 * One web-vitals sample, already reduced to a histogram bucket.
 *
 * The bucket index, never the raw value: a histogram answers "what fraction of
 * visits were bad?" at constant storage cost, and `bucketIndex` from
 * `@alepha/sigil/vitals` is the one place the boundaries are defined so the
 * chart and the ingest cannot disagree about what "good" means.
 */
export interface AnalyticsVitalSample {
  sigilId: string;
  /** UTC hour bucket, `YYYY-MM-DDTHH`. */
  hour: string;
  metric: VitalMetric;
  path: string;
  bucket: number;
  /** How many samples landed in this bucket. Batches arrive pre-folded. */
  count: number;
}

/** Everything one absorbed envelope contributes, in one call. */
export interface AnalyticsBatch {
  views?: AnalyticsViewSample[];
  uniques?: AnalyticsUniqueSample[];
  vitals?: AnalyticsVitalSample[];
}

/**
 * The window every read is scoped to.
 *
 * `sigilIds` is always an explicit list rather than a project id: the store
 * knows nothing about projects, and resolving "which apps belong to this
 * caller" is an authorization question that has to stay in the app.
 */
export interface AnalyticsWindow {
  sigilIds: string[];
  /** First UTC day included, `YYYY-MM-DD`. */
  since: string;
}

export interface AnalyticsTimelinePoint {
  /** UTC day, `YYYY-MM-DD`. */
  date: string;
  views: number;
}

export interface AnalyticsLeaderboardRow {
  key: string;
  count: number;
}

/** Bucket index → how many samples, per metric. Absent metrics saw none. */
export type AnalyticsVitalHistograms = Partial<
  Record<VitalMetric, Map<number, number>>
>;

/**
 * Where an app's analytics live.
 *
 * **Question-shaped, not query-shaped**, and that is the whole design. The two
 * known backends aggregate at opposite ends: the orm one pre-aggregates on
 * write, upserting into buckets; Workers Analytics Engine appends raw points
 * and aggregates on read. A general query surface would force a mini query
 * planner to be written twice, once per strategy, and the two would drift.
 *
 * So the interface is a **closed set of questions** — exactly the ones the
 * insights surface asks, and nothing else. Adding a sixth question is a
 * deliberate act that touches every implementation, which is the point: it is
 * the moment to check that every backend can actually answer it.
 *
 * ## Deliberately not here
 *
 * - **Blights.** Mutable triage state (`open` / `resolved` / `quest:<id>`)
 *   belongs in a database you can update, not in an append-only analytics
 *   store.
 * - **Error groups.** They keep the *first* stack sample, which means reading
 *   before writing. A write-only backend cannot do it, so the question would be
 *   unanswerable by half the implementations.
 */
export interface AnalyticsStore {
  /**
   * Record everything one envelope contributed.
   *
   * Batched on purpose: against a remote database the round-trip dominates, so
   * the caller folds duplicates and hands over one batch rather than a call per
   * sample.
   */
  absorb(batch: AnalyticsBatch): Promise<void>;

  /** Raw page views in the window. Best-effort — inflatable by the reporter. */
  totalViews(window: AnalyticsWindow): Promise<number>;

  /**
   * Distinct visitors in the window.
   *
   * One number, not a per-app breakdown, because the same person visiting two
   * of a project's apps on one day is one visitor and only the store can know
   * that — the caller cannot sum per-app counts and get it right.
   */
  uniqueVisitors(window: AnalyticsWindow): Promise<number>;

  /** Views per UTC day. May omit days with no views; the caller zero-fills. */
  timeline(window: AnalyticsWindow): Promise<AnalyticsTimelinePoint[]>;

  /** Most-viewed paths, descending. `key` is the path. */
  topPaths(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<AnalyticsLeaderboardRow[]>;

  /** Most-viewed countries, descending. `key` is the ISO-3166 code. */
  topCountries(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<AnalyticsLeaderboardRow[]>;

  /**
   * Vitals histograms, merged across every sigil in the window.
   *
   * Histograms rather than percentiles: the p75 of two distributions is not the
   * mean of their p75s, so merging has to happen at the bucket level. The
   * caller walks them — one implementation of that walk, shared by every
   * backend.
   */
  vitalHistograms(window: AnalyticsWindow): Promise<AnalyticsVitalHistograms>;
}
