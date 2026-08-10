import { AnalyticsEngineSql } from "@alepha/analytics";
import type { VitalMetric } from "../shared/schemas/sigilVitalsBuckets.ts";
import type {
  AnalyticsBatch,
  AnalyticsLeaderboardRow,
  AnalyticsStore,
  AnalyticsTimelinePoint,
  AnalyticsVitalHistograms,
  AnalyticsWindow,
} from "./AnalyticsStore.ts";

/**
 * The write half of a Workers Analytics Engine dataset binding.
 *
 * Declared here rather than imported from `@cloudflare/workers-types` so this
 * module compiles and tests anywhere — the whole surface is one method, and
 * depending on the Workers type package to describe it would make a store that
 * needs no workerd API only buildable under workerd.
 */
export interface AnalyticsEngineDataset {
  writeDataPoint(point: {
    indexes?: string[];
    blobs?: Array<string | null>;
    doubles?: number[];
  }): void;
}

export interface WaeAnalyticsStoreOptions {
  /** The `analytics_engine_datasets` binding (`env.ANALYTICS`). */
  dataset: AnalyticsEngineDataset;
  /** Dataset name as it appears in `FROM` — the same string as the binding's. */
  datasetName: string;
  /** Read side. See `AnalyticsEngineSql` for the token's blast radius. */
  sql: AnalyticsEngineSql;
  /**
   * Where unique visitors live. **Not optional** — see the class docstring for
   * why they cannot move onto Analytics Engine at all.
   */
  uniques: AnalyticsStore;
}

/**
 * Blob slots, named once so the write and the read cannot drift.
 *
 * Views and vitals share one dataset — Analytics Engine has no table concept
 * — so every row carries an explicit **kind marker in `blob1`**. Discriminating
 * on the shape instead ("a view has one double, a vital has two") was the
 * first attempt and it is the kind of cleverness that breaks silently the
 * first time either shape gains a field. Both kinds also put the hour bucket
 * in the same slot, so a query that filters the window does not have to know
 * which kind it is looking at.
 */
const KIND = 1;
const KIND_VIEW = "v";
const KIND_VITAL = "p";
const VIEW_PATH = 2;
const VIEW_COUNTRY = 3;
const VITAL_METRIC = 2;
/** Same slot on both kinds, deliberately. */
const HOUR = 4;

/**
 * Views and vitals on Workers Analytics Engine; uniques delegated to a real
 * database.
 *
 * A **composite**, not a replacement, and the split is forced rather than
 * chosen.
 *
 * ## Why unique visitors cannot move
 *
 * `count(DISTINCT x)` exists in the WAE SQL dialect, but sampling is equitable
 * *per index value* and the docs say plainly that you may not be able to get
 * accurate unique counts of fields that are not in the index. There is exactly
 * one index (96 bytes). Put the visitor hash in it and index cardinality
 * equals visitor count, which defeats the sampler's entire design; leave it in
 * a blob and sampling drops visitors — and `_sample_interval` **cannot**
 * correct a `DISTINCT`, only `count` / `sum` / `avg` / quantiles.
 *
 * Keeping uniques relational also keeps them exact, deletable, cascade-correct
 * and GDPR-erasable, which matters because the visitor hash is the only
 * personal data on this path.
 *
 * ## Two wins beyond cost
 *
 * `writeDataPoint()` is fire-and-forget: it returns nothing, is not awaited,
 * and the runtime writes in the background. The sequential-round-trip problem
 * disappears on this path entirely.
 *
 * And nothing here needs a workerd-only API — the binding is an object the
 * caller passes in and reads go over `fetch`. So this store is a plain module
 * rather than the `index.workerd.ts` conditional entry the original plan
 * called for, which means `vitest` can exercise it against a fake binding.
 * That mattered more than the file name: `wrangler dev` treats AE writes as
 * no-ops, so a conditional entry would have been untestable by construction.
 *
 * ## Every number read back is an estimate
 *
 * Counts come back as `sum(double * _sample_interval)`, never `count()`. The
 * sample interval varies per row, so a constant multiplier would be wrong. The
 * UI has to say so — the same traffic reports different totals here than on a
 * relational deployment, permanently.
 *
 * ## The hour bucket travels as a blob, not as the row's timestamp
 *
 * WAE stamps `timestamp` at write time and offers no way to backdate a point.
 * A sample for 14:00 that arrives at 15:05 — a batched envelope, a retry, a
 * client that buffered — would land in the wrong hour, and the timeline would
 * disagree with the relational store for reasons that have nothing to do with
 * sampling. The bucket the caller computed is therefore written as a blob and
 * grouped on, and `timestamp` is left as the arrival record it actually is.
 */
export class WaeAnalyticsStore implements AnalyticsStore {
  protected readonly options: WaeAnalyticsStoreOptions;

  constructor(options: WaeAnalyticsStoreOptions) {
    this.options = options;
  }

  async absorb(batch: AnalyticsBatch): Promise<void> {
    for (const view of batch.views ?? []) {
      this.options.dataset.writeDataPoint({
        indexes: [view.sigilId],
        blobs: [KIND_VIEW, view.path, view.country, view.hour],
        doubles: [view.count],
      });
    }

    for (const vital of batch.vitals ?? []) {
      this.options.dataset.writeDataPoint({
        indexes: [vital.sigilId],
        blobs: [KIND_VITAL, vital.metric, vital.path, vital.hour],
        doubles: [vital.bucket, vital.count],
      });
    }

    // Not awaited above on purpose — `writeDataPoint` is fire-and-forget and
    // returns nothing. This await is the uniques delegation, which is a real
    // database round-trip.
    if (batch.uniques?.length) {
      await this.options.uniques.absorb({ uniques: batch.uniques });
    }
  }

  async totalViews(window: AnalyticsWindow): Promise<number> {
    if (window.sigilIds.length === 0) return 0;
    const rows = await this.options.sql.query(`
      SELECT sum(double1 * _sample_interval) AS total
      FROM ${this.options.datasetName}
      WHERE ${this.viewsWhere(window)}
    `);
    return AnalyticsEngineSql.num(rows[0] ?? {}, "total");
  }

  /**
   * Delegated in full. The composite exists for this method.
   */
  async uniqueVisitors(window: AnalyticsWindow): Promise<number> {
    return this.options.uniques.uniqueVisitors(window);
  }

  async timeline(window: AnalyticsWindow): Promise<AnalyticsTimelinePoint[]> {
    if (window.sigilIds.length === 0) return [];
    // The first ten characters of an `YYYY-MM-DDTHH` bucket are its day —
    // the same substring trick the relational store uses, for the same
    // reason: no date arithmetic, and the storage stays hourly.
    const rows = await this.options.sql.query(`
      SELECT substring(blob${HOUR}, 1, 10) AS date,
             sum(double1 * _sample_interval) AS views
      FROM ${this.options.datasetName}
      WHERE ${this.viewsWhere(window)}
      GROUP BY date
    `);
    return rows
      .map((row) => ({
        date: AnalyticsEngineSql.str(row, "date"),
        views: AnalyticsEngineSql.num(row, "views"),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async topPaths(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<AnalyticsLeaderboardRow[]> {
    return this.leaderboard(window, limit, `blob${VIEW_PATH}`);
  }

  async topCountries(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<AnalyticsLeaderboardRow[]> {
    return this.leaderboard(window, limit, `blob${VIEW_COUNTRY}`);
  }

  async vitalHistograms(
    window: AnalyticsWindow,
  ): Promise<AnalyticsVitalHistograms> {
    if (window.sigilIds.length === 0) return {};
    const rows = await this.options.sql.query(`
      SELECT blob${VITAL_METRIC} AS metric,
             double1 AS bucket,
             sum(double2 * _sample_interval) AS samples
      FROM ${this.options.datasetName}
      WHERE ${this.vitalsWhere(window)}
      GROUP BY metric, bucket
    `);

    const histograms: AnalyticsVitalHistograms = {};
    for (const row of rows) {
      const metric = AnalyticsEngineSql.str(row, "metric") as VitalMetric;
      if (!metric) continue;
      const bucket = AnalyticsEngineSql.num(row, "bucket");
      const samples = AnalyticsEngineSql.num(row, "samples");
      if (samples === 0) continue;
      const histogram = histograms[metric] ?? new Map<number, number>();
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + samples);
      histograms[metric] = histogram;
    }
    return histograms;
  }

  protected async leaderboard(
    window: AnalyticsWindow,
    limit: number,
    column: string,
  ): Promise<AnalyticsLeaderboardRow[]> {
    if (window.sigilIds.length === 0) return [];
    const rows = await this.options.sql.query(`
      SELECT ${column} AS key,
             sum(double1 * _sample_interval) AS count
      FROM ${this.options.datasetName}
      WHERE ${this.viewsWhere(window)}
      GROUP BY key
      ORDER BY count DESC
      LIMIT ${AnalyticsEngineSql.quote(limit)}
    `);
    return rows.map((row) => ({
      key: AnalyticsEngineSql.str(row, "key"),
      count: AnalyticsEngineSql.num(row, "count"),
    }));
  }

  /**
   * `_sample_interval` is deliberately absent from every WHERE clause: it is a
   * property of the *sample*, not of the event, so filtering on it would bias
   * the very correction it exists to enable.
   */
  protected where(window: AnalyticsWindow, kind: string): string {
    return [
      `blob${KIND} = ${AnalyticsEngineSql.quote(kind)}`,
      `index1 IN (${AnalyticsEngineSql.quoteList(window.sigilIds)})`,
      `blob${HOUR} >= ${AnalyticsEngineSql.quote(window.since)}`,
    ].join(" AND ");
  }

  protected viewsWhere(window: AnalyticsWindow): string {
    return this.where(window, KIND_VIEW);
  }

  protected vitalsWhere(window: AnalyticsWindow): string {
    return this.where(window, KIND_VITAL);
  }
}
