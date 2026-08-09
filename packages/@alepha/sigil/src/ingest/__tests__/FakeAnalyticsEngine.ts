import { MemoryAnalyticsStore } from "../MemoryAnalyticsStore.ts";
import type { AnalyticsEngineDataset } from "../WaeAnalyticsStore.ts";

interface Point {
  indexes: string[];
  blobs: Array<string | null>;
  doubles: number[];
}

/**
 * An in-process stand-in for a Workers Analytics Engine dataset and its SQL
 * API, good enough to run the shared conformance spec against
 * `WaeAnalyticsStore`.
 *
 * ## Why this has to exist
 *
 * There is no other way to test that store at all. `vitest` cannot bind an
 * Analytics Engine dataset, and `wrangler dev` treats `writeDataPoint` as a
 * **no-op** — so under the only local runtime that has the binding, every
 * write silently disappears and every read comes back empty. A fake is not a
 * convenience here; it is the only executable description of the contract.
 *
 * ## What it is honest about, and what it is not
 *
 * It stores points exactly as written, so it catches the failures worth
 * catching: a blob written to one slot and read from another, a kind marker
 * that does not discriminate, a window filter comparing the wrong column, a
 * missing `_sample_interval` correction (every point here has an interval of
 * 1, so a query that forgot the multiplication still returns the right number
 * — which is why the spec below also asserts the *SQL text*).
 *
 * It does **not** simulate sampling, and deliberately: the design accepts that
 * WAE returns estimates, so a fake that invented a sampling rate would make
 * the conformance spec assert numbers that production will not reproduce. The
 * spec asserts behaviour; sampling is the one thing it must stay silent about.
 *
 * The query "engine" is a small pattern-matcher over the handful of statement
 * shapes `WaeAnalyticsStore` emits, not a SQL parser. If that store grows a
 * sixth query shape, this must learn it — which is the intended friction, per
 * `AnalyticsStore`'s closed-question design.
 */
export class FakeAnalyticsEngine {
  readonly points: Point[] = [];
  /** Every statement executed, in order — asserted on, not just recorded. */
  readonly queries: string[] = [];

  readonly dataset: AnalyticsEngineDataset = {
    writeDataPoint: (point) => {
      this.points.push({
        indexes: point.indexes ?? [],
        blobs: point.blobs ?? [],
        doubles: point.doubles ?? [],
      });
    },
  };

  /** Drop-in for `AnalyticsEngineSql.query`. */
  query = async (
    sql: string,
  ): Promise<Array<Record<string, string | number | null>>> => {
    this.queries.push(sql);
    const kind = /blob1 = '([^']*)'/.exec(sql)?.[1] ?? "";
    const ids = [
      ...(/index1 IN \(([^)]*)\)/.exec(sql)?.[1] ?? "").matchAll(/'([^']*)'/g),
    ].map((m) => m[1]);
    const since = /blob4 >= '([^']*)'/.exec(sql)?.[1] ?? "";

    const rows = this.points.filter(
      (p) =>
        p.blobs[0] === kind &&
        ids.includes(p.indexes[0] ?? "") &&
        String(p.blobs[3] ?? "") >= since,
    );

    // --- vitals: GROUP BY metric, bucket
    if (kind === "p") {
      const grouped = new Map<string, number>();
      for (const p of rows) {
        const key = `${p.blobs[1]}|${p.doubles[0]}`;
        grouped.set(key, (grouped.get(key) ?? 0) + (p.doubles[1] ?? 0));
      }
      return [...grouped.entries()].map(([key, samples]) => {
        const [metric, bucket] = key.split("|");
        return { metric, bucket: Number(bucket), samples };
      });
    }

    // --- views: total / timeline / leaderboard, told apart by the projection
    if (/AS total/.test(sql)) {
      return [{ total: rows.reduce((sum, p) => sum + (p.doubles[0] ?? 0), 0) }];
    }

    if (/AS date/.test(sql)) {
      const byDate = new Map<string, number>();
      for (const p of rows) {
        const date = String(p.blobs[3] ?? "").slice(0, 10);
        byDate.set(date, (byDate.get(date) ?? 0) + (p.doubles[0] ?? 0));
      }
      return [...byDate.entries()].map(([date, views]) => ({ date, views }));
    }

    // Leaderboard — the grouped column is named in the projection.
    const slot = /SELECT blob(\d)/.exec(sql)?.[1];
    const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? "0");
    const byKey = new Map<string, number>();
    for (const p of rows) {
      const key = String(p.blobs[Number(slot) - 1] ?? "");
      byKey.set(key, (byKey.get(key) ?? 0) + (p.doubles[0] ?? 0));
    }
    return [...byKey.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, limit);
  };

  /** The relational half of the composite — uniques never reach WAE. */
  readonly uniques = new MemoryAnalyticsStore();
}
