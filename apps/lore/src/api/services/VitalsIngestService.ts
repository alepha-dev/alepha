import {
  bucketIndex,
  METRICS,
  VITALS_BUCKETS,
  type VitalMetric,
} from "@alepha/sigil/vitals";
import { $inject, t } from "alepha";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { sigilVitals } from "../entities/sigilVitals.ts";
import { SigilIngestSupport } from "./SigilIngestSupport.ts";

/** A single Web-Vitals sample as supplied by the embed bundle. */
export interface VitalsSample {
  path: string;
  metric: VitalMetric;
  value: number;
}

/** Max stored length of a normalized `path`. Mirrors the column `maxLength`. */
const PATH_MAX = 1_024;
/**
 * Max distinct `(date, path)` rows a single sigil may accumulate per UTC
 * day. Mirrors the cap from `BeaconIngestService` — a runaway site that mints
 * unbounded URLs would otherwise let `sigil_vitals` grow without bound.
 * Samples for a path that exceeds this cap are silently dropped.
 */
const DISTINCT_PATH_CAP = 100;

/**
 * Set of valid metric identifiers, as a `Set` for O(1) membership checks.
 * Unknown strings from untrusted embed payloads are silently dropped.
 */
const VALID_METRICS: Set<string> = new Set(METRICS);

/**
 * Engine behind Web-Vitals histogram ingestion for the Sigils analytics
 * surface.
 *
 * Declaring `$repository(sigilVitals)` here registers `sigil_vitals` in the
 * ORM / migration graph (the migration generator scans instantiated
 * repositories — same pattern as {@link BeaconIngestService} for
 * `sigil_views`).
 *
 * Responsibilities:
 * - normalize the page `path` (drop `?query` and `#fragment`),
 * - enforce the per-sigil / per-day distinct-path cap (DB-derived),
 * - map each `value` to a `bucketIndex` via the fixed `VITALS_BUCKETS`
 *   boundaries exported from `@alepha/sigil/vitals`,
 * - upsert (`INSERT … ON CONFLICT DO UPDATE count = count + 1`) each bucket
 *   row so storage is bounded by *(path × metric × bucket)* cardinality,
 * - expose `computeP75` to derive a p75 approximation from stored bucket
 *   counts without touching raw samples.
 */
export class VitalsIngestService {
  protected support = $inject(SigilIngestSupport);
  protected database = $inject(DatabaseProvider);
  protected vitals = $repository(sigilVitals);

  /** Current UTC day bucket, `YYYY-MM-DD`. */
  utcDate(): string {
    return this.support.utcDate();
  }

  /**
   * Normalize an untrusted page path: drop the `?query` and `#fragment`,
   * default an empty path to `/`, and clamp the length. Mirrors
   * {@link BeaconIngestService.normalizePath} exactly.
   */
  normalizePath(path: string | undefined): string {
    const raw = (path ?? "/").split("?")[0]!.split("#")[0]!;
    const trimmed = raw.trim() || "/";
    return trimmed.length > PATH_MAX ? trimmed.slice(0, PATH_MAX) : trimmed;
  }

  /**
   * Ingest a batch of Web-Vitals samples for a sigil.
   *
   * Each sample is bucketed via {@link bucketIndex} and upserted into
   * `sigil_vitals`. Samples with an unknown `metric` are silently dropped.
   * Samples whose path would exceed the distinct-path cap for the day are
   * also silently dropped (the cap is checked per-path, not per-batch).
   *
   * @param sigilId  the resolved sigil id
   * @param samples  untrusted array of `{ path, metric, value }` triples
   * @param date     UTC day bucket; defaults to today via
   *                 {@link SigilIngestSupport.utcDate}
   */
  async ingestVitals(
    sigilId: string,
    samples: VitalsSample[],
    date?: string,
  ): Promise<void> {
    const utcDate = date ?? this.utcDate();

    /**
     * Cache of paths we have already determined are within the cap so we do
     * not re-query for every sample in the batch.
     *
     * - `true`  → path is known/allowed for today; upserts may proceed.
     * - `false` → path was a new path that exceeded the cap; drop samples.
     */
    const pathAllowed = new Map<string, boolean>();

    for (const sample of samples) {
      // Drop unknown metrics from untrusted embed payloads.
      if (!VALID_METRICS.has(sample.metric)) continue;

      const path = this.normalizePath(sample.path);

      // --- Distinct-path cap check (mirrors BeaconIngestService exactly).
      if (!pathAllowed.has(path)) {
        // Check whether this path already has a row for this sigil+date (any
        // metric, any bucket); if so it was already admitted on a prior call
        // or earlier in this batch and is unconditionally allowed.
        const knownCount = await this.vitals.count({
          sigilId: { eq: sigilId },
          date: { eq: utcDate },
          path: { eq: path },
        });

        if (knownCount > 0) {
          pathAllowed.set(path, true);
        } else {
          // New path: check the day's total distinct-path count.
          // Uses DatabaseProvider.run — the same raw-SQL pattern proven on
          // Cloudflare D1 by BeaconIngestService and CampaignStatsController.
          const rows = await this.database.run(
            sql`
              SELECT COUNT(DISTINCT ${this.vitals.table.path}) AS paths
              FROM ${this.vitals.table}
              WHERE ${this.vitals.table.sigilId} = ${sigilId}
                AND ${this.vitals.table.date} = ${utcDate}
            `,
            t.object({ paths: t.string() }),
          );
          const paths = Number(rows[0]?.paths) || 0;
          pathAllowed.set(path, paths < DISTINCT_PATH_CAP);
        }
      }

      if (!pathAllowed.get(path)) continue;

      const bucket = bucketIndex(sample.metric as VitalMetric, sample.value);

      // --- Bucket upsert: INSERT … ON CONFLICT DO UPDATE count = count + 1.
      await this.vitals.upsert(
        {
          sigilId,
          date: utcDate,
          path,
          metric: sample.metric,
          bucket,
          count: 1,
        },
        {
          target: ["sigilId", "date", "path", "metric", "bucket"],
          set: { count: sql`${this.vitals.table.count} + 1` },
        },
      );
    }
  }

  /**
   * Compute an approximate p75 for a given metric from stored bucket counts.
   *
   * Aggregates `count` per bucket across the given sigil, optional path
   * filter, and optional date range. Walks buckets in ascending order,
   * accumulating counts until the cumulative total reaches or exceeds
   * `ceil(0.75 × total)`. Returns the **upper boundary** of that bucket from
   * `VITALS_BUCKETS[metric]`.
   *
   * Overflow bucket behaviour: a value that exceeded all boundaries was placed
   * in bucket index `boundaries.length`. For that overflow bucket the upper
   * boundary is undefined; this implementation returns the last defined
   * boundary (`VITALS_BUCKETS[metric][last]`) as a conservative floor —
   * documenting rather than hiding that the real value was ≥ the last
   * boundary. Callers that need to distinguish "at overflow" can check whether
   * the returned value equals the last boundary.
   *
   * @returns p75 approximation, or `null` if no samples exist.
   */
  async computeP75(
    sigilId: string,
    path: string | null,
    metric: VitalMetric,
    opts?: { from?: string; to?: string },
  ): Promise<number | null> {
    // Build WHERE clause fragments for optional path and date range.
    const pathFilter =
      path !== null ? sql`AND ${this.vitals.table.path} = ${path}` : sql``;
    const fromFilter =
      opts?.from !== undefined
        ? sql`AND ${this.vitals.table.date} >= ${opts.from}`
        : sql``;
    const toFilter =
      opts?.to !== undefined
        ? sql`AND ${this.vitals.table.date} <= ${opts.to}`
        : sql``;

    // Fetch bucket → total-count pairs ordered ascending by bucket index.
    const rows = await this.database.run(
      sql`
        SELECT ${this.vitals.table.bucket} AS bucket,
               SUM(${this.vitals.table.count}) AS total
        FROM ${this.vitals.table}
        WHERE ${this.vitals.table.sigilId} = ${sigilId}
          AND ${this.vitals.table.metric} = ${metric}
          ${pathFilter}
          ${fromFilter}
          ${toFilter}
        GROUP BY ${this.vitals.table.bucket}
        ORDER BY ${this.vitals.table.bucket} ASC
      `,
      t.object({ bucket: t.string(), total: t.string() }),
    );

    if (rows.length === 0) return null;

    // Build a sparse map of bucket → count and sum the total samples.
    let grandTotal = 0;
    const bucketCounts = new Map<number, number>();
    for (const row of rows) {
      const b = Number(row.bucket);
      const c = Number(row.total);
      bucketCounts.set(b, c);
      grandTotal += c;
    }

    if (grandTotal === 0) return null;

    // Walk ascending bucket indices until cumulative count ≥ ceil(0.75 × total).
    const boundaries = VITALS_BUCKETS[metric];
    const overflowIdx = boundaries.length;
    const target = Math.ceil(0.75 * grandTotal);
    let cumulative = 0;

    for (let i = 0; i <= overflowIdx; i++) {
      cumulative += bucketCounts.get(i) ?? 0;
      if (cumulative >= target) {
        // Return the upper boundary for this bucket.
        // For the overflow bucket (i === overflowIdx), use the last defined
        // boundary as a conservative floor.
        return boundaries[Math.min(i, boundaries.length - 1)]!;
      }
    }

    // Exhausted all buckets — return the last boundary as a floor.
    return boundaries[boundaries.length - 1]!;
  }
}
