import type {
  AnalyticsBatch,
  AnalyticsLeaderboardRow,
  AnalyticsStore,
  AnalyticsTimelinePoint,
  AnalyticsVitalHistograms,
  AnalyticsWindow,
} from "./AnalyticsStore.ts";

interface ViewRow {
  sigilId: string;
  hour: string;
  path: string;
  country: string;
  count: number;
}

interface VitalRow {
  sigilId: string;
  hour: string;
  metric: string;
  path: string;
  buckets: Map<number, number>;
}

/**
 * An {@link AnalyticsStore} that keeps everything in maps.
 *
 * **Required, not a convenience.** `vitest` cannot exercise an Analytics
 * Engine binding, and `wrangler dev` treats AE writes as no-ops — so without
 * an in-memory store there is no way to test anything that talks to a store on
 * the workerd path at all. It is also the house idiom
 * (`MemoryFileSystemProvider`, `MemoryQueueProvider`, …), which is why it
 * ships the usual assertion helpers rather than making every caller reach into
 * its internals.
 *
 * It aggregates on write like the orm store does, and it answers the same five
 * questions — the shared conformance spec runs against both, so a behavioural
 * divergence is a red test.
 */
export class MemoryAnalyticsStore implements AnalyticsStore {
  /** Keyed `sigilId|hour|path|country`. */
  protected views = new Map<string, ViewRow>();
  /** Keyed `sigilId|day|visitorHash` → the row's count. */
  protected uniques = new Map<
    string,
    { sigilId: string; day: string; visitorHash: string; count: number }
  >();
  /** Keyed `sigilId|hour|metric|path`. */
  protected vitals = new Map<string, VitalRow>();

  async absorb(batch: AnalyticsBatch): Promise<void> {
    for (const view of batch.views ?? []) {
      const key = `${view.sigilId}|${view.hour}|${view.path}|${view.country}`;
      const row = this.views.get(key);
      if (row) row.count += view.count;
      else this.views.set(key, { ...view });
    }
    for (const unique of batch.uniques ?? []) {
      const key = `${unique.sigilId}|${unique.day}|${unique.visitorHash}`;
      // Seeing the same visitor twice in a day is the expected case, not an
      // error — and it must not raise the count, which is what "unique" means.
      if (!this.uniques.has(key)) {
        this.uniques.set(key, { ...unique, count: 1 });
      }
    }
    for (const vital of batch.vitals ?? []) {
      const key = `${vital.sigilId}|${vital.hour}|${vital.metric}|${vital.path}`;
      let row = this.vitals.get(key);
      if (!row) {
        row = {
          sigilId: vital.sigilId,
          hour: vital.hour,
          metric: vital.metric,
          path: vital.path,
          buckets: new Map(),
        };
        this.vitals.set(key, row);
      }
      row.buckets.set(
        vital.bucket,
        (row.buckets.get(vital.bucket) ?? 0) + vital.count,
      );
    }
  }

  async totalViews(window: AnalyticsWindow): Promise<number> {
    let total = 0;
    for (const row of this.viewsIn(window)) total += row.count;
    return total;
  }

  async uniqueVisitors(window: AnalyticsWindow): Promise<number> {
    const scope = new Set(window.sigilIds);
    // `day|hash` and not `sigilId|day|hash`: the same person visiting two of a
    // project's apps on one day is one visitor, and counting per sigil would
    // say two. Mirrors the orm store's `COUNT(DISTINCT day || '|' || hash)`.
    const seen = new Set<string>();
    let collapsed = 0;
    for (const row of this.uniques.values()) {
      if (!scope.has(row.sigilId) || row.day < window.since) continue;
      if (row.visitorHash === COLLAPSED) collapsed += row.count;
      else seen.add(`${row.day}|${row.visitorHash}`);
    }
    return seen.size + collapsed;
  }

  async timeline(window: AnalyticsWindow): Promise<AnalyticsTimelinePoint[]> {
    const byDate = new Map<string, number>();
    for (const row of this.viewsIn(window)) {
      const date = row.hour.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + row.count);
    }
    return [...byDate.entries()]
      .map(([date, views]) => ({ date, views }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async topPaths(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<AnalyticsLeaderboardRow[]> {
    return this.leaderboard(window, limit, (row) => row.path);
  }

  async topCountries(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<AnalyticsLeaderboardRow[]> {
    return this.leaderboard(window, limit, (row) => row.country);
  }

  async vitalHistograms(
    window: AnalyticsWindow,
  ): Promise<AnalyticsVitalHistograms> {
    const scope = new Set(window.sigilIds);
    const histograms: AnalyticsVitalHistograms = {};
    for (const row of this.vitals.values()) {
      if (!scope.has(row.sigilId) || row.hour < window.since) continue;
      const metric = row.metric as keyof AnalyticsVitalHistograms;
      const histogram = histograms[metric] ?? new Map<number, number>();
      for (const [bucket, count] of row.buckets) {
        if (count === 0) continue;
        histogram.set(bucket, (histogram.get(bucket) ?? 0) + count);
      }
      histograms[metric] = histogram;
    }
    return histograms;
  }

  // -------------------------------------------------------------------------
  // Test assertion helpers
  // -------------------------------------------------------------------------

  /** How many views landed on `path`, across every sigil and hour. */
  viewsFor(path: string): number {
    let total = 0;
    for (const row of this.views.values()) {
      if (row.path === path) total += row.count;
    }
    return total;
  }

  /** Whether this visitor was recorded for that day. */
  sawVisitor(sigilId: string, day: string, visitorHash: string): boolean {
    return this.uniques.has(`${sigilId}|${day}|${visitorHash}`);
  }

  /** Bucket counts recorded for one metric, merged across everything. */
  bucketsFor(metric: string): Map<number, number> {
    const merged = new Map<number, number>();
    for (const row of this.vitals.values()) {
      if (row.metric !== metric) continue;
      for (const [bucket, count] of row.buckets) {
        merged.set(bucket, (merged.get(bucket) ?? 0) + count);
      }
    }
    return merged;
  }

  /** Forget everything. For a test that reuses one store across cases. */
  clear(): void {
    this.views.clear();
    this.uniques.clear();
    this.vitals.clear();
  }

  protected *viewsIn(window: AnalyticsWindow): Generator<ViewRow> {
    const scope = new Set(window.sigilIds);
    for (const row of this.views.values()) {
      // Lexicographic, exactly like the orm store's `hour >= since`: an hour
      // bucket `YYYY-MM-DDTHH` shares its first ten characters with a day.
      if (!scope.has(row.sigilId) || row.hour < window.since) continue;
      yield row;
    }
  }

  protected leaderboard(
    window: AnalyticsWindow,
    limit: number,
    keyOf: (row: ViewRow) => string,
  ): AnalyticsLeaderboardRow[] {
    const counts = new Map<string, number>();
    for (const row of this.viewsIn(window)) {
      const key = keyOf(row);
      counts.set(key, (counts.get(key) ?? 0) + row.count);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, limit);
  }
}

/**
 * Local copy of the collapsed-row sentinel.
 *
 * Imported from the entity module would drag `alepha/orm` — and a database
 * driver — into a store whose entire point is to need neither.
 */
const COLLAPSED = "*";
