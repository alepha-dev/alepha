import type { AnalyticsRow } from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import { AnalyticsFolds } from "./AnalyticsFolds.ts";

/**
 * One reading as a caller records it: its bucket, the instant it was taken
 * (millis, the `last` tie-break), every dimension, and a value per measure.
 * A gauge may be omitted.
 */
export type AnalyticsReading = Record<
  string,
  string | number | null | undefined
> & { hour: string; at?: number };

/**
 * Merges rows that share a bucket and every dimension into one, before they
 * reach a provider.
 *
 * A relational upsert refuses a batch that names the same conflict target
 * twice: Postgres throws "ON CONFLICT DO UPDATE command cannot affect row a
 * second time", while SQLite applies the duplicates one after the other and
 * memory keeps both. The same `recordMany()` used to throw on one backend and
 * succeed on the others. Folding first means every provider receives distinct
 * keys, and Analytics Engine receives fewer, already-merged points, which is
 * equally correct for every fold.
 *
 * Pure: the clock is never read here, so the caller stamps buckets first.
 */
export class AnalyticsRowFolder {
  /**
   * One stored row per `(bucket, ...dimensions)`, in first-seen order. Every
   * fold of every measure is merged by `AnalyticsFolds`; a reading without
   * `at` counts as taken at `0`.
   */
  public static fold(
    dataset: AnalyticsDataset,
    rows: AnalyticsReading[],
  ): AnalyticsRow[] {
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const folded = new Map<string, AnalyticsRow>();

    for (const row of rows) {
      const stored = AnalyticsFolds.toStored(dataset, row, row.at ?? 0);
      // JSON rather than a delimiter join: a dimension value can hold any
      // character, and a collision here would merge two distinct groups.
      const key = AnalyticsRowFolder.key(dimensions, stored);
      const existing = folded.get(key);
      if (existing) {
        AnalyticsFolds.merge(dataset, existing, stored);
      } else {
        folded.set(key, stored);
      }
    }

    return [...folded.values()];
  }

  /**
   * The grouping key of a row: its bucket and its sorted dimension values.
   */
  public static key(
    dimensions: string[],
    row: Record<string, unknown> & { hour: string },
  ): string {
    return JSON.stringify([row.hour, ...dimensions.map((name) => row[name])]);
  }
}
