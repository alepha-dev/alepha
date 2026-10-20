import type { AnalyticsRow } from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";

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
   * One row per `(bucket, ...dimensions)`, in first-seen order.
   */
  public static fold(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): AnalyticsRow[] {
    if (rows.length < 2) return rows;

    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const measures = Object.keys(dataset.measures.shape);
    const folded = new Map<string, AnalyticsRow>();

    for (const row of rows) {
      // JSON rather than a delimiter join: a dimension value can hold any
      // character, and a collision here would merge two distinct groups.
      const key = JSON.stringify([
        row.hour,
        ...dimensions.map((name) => row[name]),
      ]);
      const existing = folded.get(key);
      if (!existing) {
        folded.set(key, { ...row });
        continue;
      }
      for (const name of measures) {
        existing[name] = Number(existing[name] ?? 0) + Number(row[name] ?? 0);
      }
    }

    return [...folded.values()];
  }
}
