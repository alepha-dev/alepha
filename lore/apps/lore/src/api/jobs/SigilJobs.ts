import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  sigilUniquesDaily,
  UNIQUES_COLLAPSED_HASH,
} from "../entities/sigilUniquesDaily.ts";

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
 * Most days one sweep will fold. A table nobody has ever pruned can hold an
 * arbitrary backlog, and this runs hourly on a Worker with a wall-clock and a
 * memory ceiling — so the first few sweeps chew through the history instead of
 * trying to swallow it whole. Nothing is lost by taking several hours: the
 * fold is idempotent, so the next sweep simply picks up where this one stopped.
 */
const MAX_DAYS_PER_SWEEP = 14;

/**
 * Keeps `sigil_uniques_daily` from growing without bound.
 *
 * This used to also collapse `sigil_views_hourly` into daily buckets
 * (`collapseViews`, deleted). That half retired along with the rest of the
 * legacy views/vitals write and read path: `SigilIngestService` no longer
 * writes `sigil_views_hourly` at all, and `AnalyticsRollupJobs`
 * (`alepha/api/analytics`) owns retention for the `sigil_views` / `sigil_vitals`
 * `$analytics()` datasets that replaced it — its own sweep, exercised in that
 * package's own test suite, not this one. `sigil_views_hourly` is therefore
 * now frozen: whatever rows it already holds stay exactly as they are, with
 * nothing left to write to it, read it or sweep it.
 *
 * Uniques could not follow the same path — a distinct visitor count cannot
 * survive sampling or a rollup — so this class survives for exactly that one
 * table. The collapse is privacy maintenance, not storage maintenance: it is
 * what makes the per-visitor hashes stop existing after
 * {@link UNIQUES_COLLAPSE_AFTER_DAYS}, not a way to save space. Nothing else
 * would delete them at all — `BlightJobs` sweeps `blights` only.
 *
 * The collapse *folds* rather than deletes, so `uniqueVisitors` never changes
 * for a window that was already fully outside the collapse boundary — see
 * `collapseUniques`'s own doc for the one cross-app case that is a known,
 * accepted approximation. Plain SQL-free repository work, so it behaves
 * identically on SQLite, Postgres and D1.
 *
 * **D1 safety**: `sigil_uniques_daily` is a CASCADE *child* of `sigils`.
 * Reshaping a child is safe; the wipe bomb is rebuilding a parent. `count`
 * was added with a `DEFAULT` for the separate `ADD COLUMN … NOT NULL` trap.
 */
export class SigilJobs {
  protected readonly log = $logger();
  protected readonly uniques = $repository(sigilUniquesDaily);
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
   * The distinct `day` values below the cutoff that still hold visitor hashes,
   * oldest first.
   *
   * The sweep works one day at a time rather than loading every stale row: a
   * table nobody has ever pruned can hold an unbounded backlog, and this runs
   * on a Cloudflare Worker with a hard memory ceiling. One day's rows for all
   * sigils is a bounded, self-limiting unit of work — and because the fold is
   * idempotent, a sweep that runs out of time simply finishes on the next hour.
   *
   * ⚠️ **The `visitorHash` clause is what makes the sweep converge.** A
   * collapsed row keeps the `day` it was folded from, so a filter on `day`
   * alone re-selects every day this job has ever finished, forever: the fold
   * re-runs, deletes the sentinel, and writes back the identical totals. That
   * is invisible in the data — the fold is idempotent, which is exactly why it
   * went unnoticed — and expensive on the wire, because each day costs a
   * select, a delete and an insert against a remote database. Production was
   * spending 12-13 seconds of D1 round-trips every hour re-folding 27 rows that
   * were already folded, which is most of what the hourly cron slot cost.
   *
   * Excluding the sentinel leaves exactly the days with real hashes left to
   * fold, so a finished day drops out permanently and an ordinary hour reads
   * nothing. Late-arriving rows are unaffected: a row written for an
   * already-collapsed day carries a real hash, so its day re-qualifies and the
   * next sweep folds it into the existing sentinel. The per-day read in
   * {@link collapseUniques} still includes the sentinel — that is what keeps
   * the totals additive rather than double-counted, and it is a different
   * question from which days are worth visiting.
   */
  protected async staleDays(cutoff: string): Promise<string[]> {
    const rows = await this.uniques.findMany({
      where: {
        day: { lt: cutoff },
        visitorHash: { ne: UNIQUES_COLLAPSED_HASH },
      },
      columns: ["day"],
      distinct: ["day"],
      orderBy: "day",
      limit: MAX_DAYS_PER_SWEEP,
    });
    return [...new Set(rows.map((row) => row.day))];
  }

  /** UTC `YYYY-MM-DD` for a millisecond timestamp. */
  protected dayString(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
