import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  sigilUniquesDaily,
  UNIQUES_COLLAPSED_HASH,
} from "../entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../entities/sigilViewsHourly.ts";

/** Milliseconds in a day — for the cutoff arithmetic. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long the per-visitor hash rows survive before being folded into a single
 * count. Two days rather than one: the salt rotates at UTC midnight, so a day
 * is only finished once the clock is comfortably past its end, and anything
 * shorter would collapse a bucket that is still being written to.
 */
export const UNIQUES_COLLAPSE_AFTER_DAYS = 2;

/**
 * How long views keep their hourly resolution. Matches the widest range the
 * Insights UI offers (1d / 7d / 30d) — past it, every read already asks for
 * days, so the hour buckets are storage with no reader.
 */
export const VIEWS_HOURLY_WINDOW_DAYS = 30;

/**
 * Most days one sweep will fold. A table nobody has ever pruned can hold an
 * arbitrary backlog, and this runs hourly on a Worker with a wall-clock and a
 * memory ceiling — so the first few sweeps chew through the history instead of
 * trying to swallow it whole. Nothing is lost by taking several hours: the
 * fold is idempotent, so the next sweep simply picks up where this one stopped.
 */
const MAX_DAYS_PER_SWEEP = 14;

/**
 * How many hour rows to scan when working out which days still need folding.
 * Only their first ten characters are used, so this is a cheap projection —
 * the cap is there so an enormous backlog cannot load itself into memory just
 * to answer "which day is oldest".
 */
const MAX_ROWS_PER_DAY_SCAN = 5_000;

/**
 * Keeps the three sigil analytics tables from growing without bound.
 *
 * Nothing used to delete from them at all: `BlightJobs` sweeps `blights` only,
 * and these tables were touched solely by `SigilIngestService` (write) and
 * `InsightsController` (read). Every row past the 30-day window was pure cost
 * with no read path.
 *
 * Both passes *collapse* rather than delete, so no number the UI shows ever
 * changes — see each job for the one exception, which is documented where it
 * happens. Both are plain SQL-free repository work and behave identically on
 * SQLite, Postgres and D1.
 *
 * **D1 safety**: these tables are CASCADE *children* of `sigils`. Reshaping a
 * child is safe; the wipe bomb is rebuilding a parent. `count` was added with
 * a `DEFAULT` for the separate `ADD COLUMN … NOT NULL` trap.
 */
export class SigilJobs {
  protected readonly log = $logger();
  protected readonly uniques = $repository(sigilUniquesDaily);
  protected readonly views = $repository(sigilViewsHourly);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Hourly sweep. Runs on the shared `0 * * * *` slot alongside
   * `BlightJobs.purgeStaleBlights` to keep the Cloudflare cron-trigger count
   * down; neither pass is time-critical to the hour.
   */
  public readonly collapseAnalytics = $job({
    cron: "0 * * * *",
    handler: async () => {
      await this.collapseUniques();
      await this.collapseViews();
    },
  });

  /**
   * Folds `(sigilId, day, visitorHash)` rows older than the window into one
   * `(sigilId, day, UNIQUES_COLLAPSED_HASH, count)` row and deletes the hashes.
   *
   * Exact for a single app. The one thing it gives up is cross-app dedup: the
   * live query counts distinct `(day, hash)` pairs, so someone who visited two
   * of a project's apps on the same day counts once — after the collapse the
   * hashes are gone and the two apps' counts can only be added, so that visitor
   * counts twice. That is inherent to not keeping the hashes, and not keeping
   * them is the point; the affected window is days already older than 48 hours.
   */
  protected async collapseUniques(): Promise<void> {
    const cutoff = this.dayString(
      this.dt.nowMillis() - UNIQUES_COLLAPSE_AFTER_DAYS * DAY_MS,
    );

    let read = 0;
    let written = 0;

    for (const day of await this.staleDays(cutoff)) {
      // Includes any row a previous sweep already collapsed — folding it back
      // in is what makes a re-run idempotent instead of double-counting, and
      // what makes it safe to work one day at a time.
      const rows = await this.uniques.findMany({ where: { day: { eq: day } } });
      if (rows.length === 0) continue;
      read += rows.length;

      const totals = new Map<string, number>();
      for (const row of rows) {
        totals.set(row.sigilId, (totals.get(row.sigilId) ?? 0) + row.count);
      }

      // Delete before writing: the collapsed row reuses the same unique index
      // as the hash rows it replaces, so the other order would collide with a
      // previous sweep's sentinel for this day.
      await this.uniques.deleteMany({ day: { eq: day } });
      await this.uniques.createMany(
        [...totals].map(([sigilId, count]) => ({
          sigilId,
          day,
          visitorHash: UNIQUES_COLLAPSED_HASH,
          count,
        })),
      );
      written += totals.size;
    }

    if (read > 0) {
      this.log.info(
        `Collapsed ${read} unique-visitor row(s) into ${written} daily total(s)`,
      );
    }
  }

  /**
   * The distinct `day` values below the cutoff, oldest first.
   *
   * The sweep works one day at a time rather than loading every stale row: a
   * table nobody has ever pruned can hold an unbounded backlog, and this runs
   * on a Cloudflare Worker with a hard memory ceiling. One day's rows for all
   * sigils is a bounded, self-limiting unit of work — and because the fold is
   * idempotent, a sweep that runs out of time simply finishes on the next hour.
   */
  protected async staleDays(cutoff: string): Promise<string[]> {
    const rows = await this.uniques.findMany({
      where: { day: { lt: cutoff } },
      columns: ["day"],
      distinct: ["day"],
      orderBy: "day",
      limit: MAX_DAYS_PER_SWEEP,
    });
    return [...new Set(rows.map((row) => row.day))];
  }

  /**
   * Folds hour buckets older than the window into one bucket per day, keeping
   * the `path` and `country` grain.
   *
   * The day bucket is written as `YYYY-MM-DDT00` rather than `YYYY-MM-DD`, so
   * the column keeps its fixed 13-character shape and every existing read
   * keeps working untouched: the timeline already groups on
   * `substr(hour, 1, 10)`, and the totals / top-paths / top-countries queries
   * only ever compare `hour >= since` and `SUM(count)`. Nothing reads the hour
   * itself, which is exactly why it is safe to drop past 30 days.
   */
  protected async collapseViews(): Promise<void> {
    const cutoffDay = this.dayString(
      this.dt.nowMillis() - VIEWS_HOURLY_WINDOW_DAYS * DAY_MS,
    );

    let read = 0;
    let written = 0;

    // Same day-at-a-time shape, and the same reason — see `staleDays`.
    for (const day of await this.staleViewDays(cutoffDay)) {
      // `YYYY-MM-DDTHH` bounded by the day's own prefix: every bucket of that
      // day sorts at or above `YYYY-MM-DD` and below `YYYY-MM-DDU` (`U` is the
      // next character after `T`), which selects the day without date maths.
      const rows = await this.views.findMany({
        where: { hour: { gte: day, lt: `${day}U` } },
      });
      if (rows.length === 0) continue;
      read += rows.length;

      const hour = `${day}T00`;
      const totals = new Map<
        string,
        { path: string; country: string; sigilId: string; n: number }
      >();
      for (const row of rows) {
        const key = `${row.sigilId}|${row.path}|${row.country}`;
        const bucket = totals.get(key);
        if (bucket) {
          bucket.n += row.count;
        } else {
          totals.set(key, {
            sigilId: row.sigilId,
            path: row.path,
            country: row.country,
            n: row.count,
          });
        }
      }

      await this.views.deleteMany({ hour: { gte: day, lt: `${day}U` } });
      await this.views.createMany(
        [...totals.values()].map((bucket) => ({
          sigilId: bucket.sigilId,
          hour,
          path: bucket.path,
          country: bucket.country,
          count: bucket.n,
        })),
      );
      written += totals.size;
    }

    if (read > 0) {
      this.log.info(
        `Collapsed ${read} hourly view row(s) into ${written} daily bucket(s)`,
      );
    }
  }

  /** The distinct days below the cutoff that still have hour buckets. */
  protected async staleViewDays(cutoffDay: string): Promise<string[]> {
    const rows = await this.views.findMany({
      where: { hour: { lt: cutoffDay } },
      columns: ["hour"],
      orderBy: "hour",
      limit: MAX_ROWS_PER_DAY_SCAN,
    });
    return [...new Set(rows.map((row) => row.hour.slice(0, 10)))].slice(
      0,
      MAX_DAYS_PER_SWEEP,
    );
  }

  /** UTC `YYYY-MM-DD` for a millisecond timestamp. */
  protected dayString(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
