import { $inject, z } from "alepha";
import { $repository, DatabaseProvider, sql } from "alepha/orm";

import {
  sigilUniquesDaily,
  UNIQUES_COLLAPSED_HASH,
} from "../entities/sigilUniquesDaily.ts";

/**
 * One visitor, once, on one day, for one app — what `absorb` accepts.
 */
export interface LoreAnalyticsUniqueSample {
  sigilId: string;
  /**
   * UTC day bucket, `YYYY-MM-DD`.
   */
  day: string;
  visitorHash: string;
}

/**
 * The window a read is scoped to.
 *
 * `sigilIds` is always an explicit list rather than a project id: this store
 * knows nothing about projects, and resolving "which apps belong to this
 * caller" is an authorization question that stays in `InsightsController`.
 */
export interface LoreAnalyticsWindow {
  sigilIds: string[];
  /**
   * First UTC day included, `YYYY-MM-DD`.
   */
  since: string;
  /**
   * Last UTC day included, `YYYY-MM-DD`. Omitted means "up to whatever the
   * newest row is", which is what every caller wanted before this existed.
   *
   * Its reason for existing is comparison: a window ending "now" ends
   * mid-day, so measuring it against a complete one reads as a collapse every
   * morning and recovers by evening. Bounding the top end is what turns
   * "yesterday against the day before" into a statement about traffic rather
   * than about the clock.
   */
  until?: string;
}

/**
 * Where Lore's unique-visitor counts live: `sigil_uniques_daily`, read and
 * written directly.
 *
 * Views and vitals used to live here too, behind the now-deleted
 * `AnalyticsStore` interface the sigil package used to ship — a question-shaped
 * contract closed over three tables so the storage backend could be swapped
 * per runtime. That contract is gone: `SigilIngestService` writes views and
 * vitals straight into `LoreAnalytics`'s `$analytics()` datasets now, and
 * `InsightsController` reads them the same way. This class is what is left —
 * **uniques only** — because a distinct visitor count is the one question
 * `$analytics()` cannot answer. Sampling and rollup both destroy the ability
 * to say "have I seen this exact hash before", which is the entire mechanism
 * a unique count depends on. See `LoreAnalytics`'s class doc for the same
 * argument from the dataset side.
 *
 * No longer a subclass of a package factory — with one table and two methods,
 * closing over a generic three-table entity factory bought nothing. It injects
 * `sigilUniquesDaily` directly, the same entity `SigilJobs`'s collapse sweep
 * already holds a repository on.
 */
export class LoreAnalyticsStore {
  protected readonly database = $inject(DatabaseProvider);
  protected readonly uniques = $repository(sigilUniquesDaily);

  /**
   * Records one batch of unique-visitor samples.
   *
   * A no-op on an empty or missing list, so a caller with nothing to report
   * (a batch that carried no visitor hash) does not have to guard the call
   * itself.
   */
  async absorb(batch: {
    uniques?: LoreAnalyticsUniqueSample[];
  }): Promise<void> {
    if (!batch.uniques?.length) return;

    // The conflict IS the expected case — a returning visitor. Setting the
    // day to itself makes it a no-op rather than an error, and crucially
    // does NOT add to `count`: a unique seen twice is still one.
    await this.uniques.upsertMany(
      batch.uniques.map((sample) => ({
        sigilId: sample.sigilId,
        day: sample.day,
        visitorHash: sample.visitorHash,
      })),
      {
        target: ["sigilId", "day", "visitorHash"],
        set: {
          day: sql`excluded.${sql.raw(this.uniques.table.day.name)}`,
        },
      },
    );
  }

  /**
   * Distinct visitors in the window.
   *
   * One number, not a per-app breakdown, because the same person visiting two
   * of a project's apps on one day is one visitor and only this store can
   * know that — the caller cannot sum per-app counts and get it right.
   */
  async uniqueVisitors(window: LoreAnalyticsWindow): Promise<number> {
    if (window.sigilIds.length === 0) return 0;
    // Two row shapes, two halves of one number. Hash rows are counted as
    // distinct `(day, visitorHash)` pairs rather than rows, so the same
    // person visiting two of a project's apps on one day is one visitor;
    // one row per sigil would say two.
    //
    // Collapsed rows no longer carry hashes, so all they can be is summed.
    // That loses cross-app dedup for those days and can over-count a visitor
    // who used two apps — accepted: the alternative is keeping per-visitor
    // hashes indefinitely, and the whole point of the collapse
    // (`SigilJobs.collapseUniques`) is that they stop existing.
    const [row] = await this.database.run(
      sql`
        SELECT
          COUNT(DISTINCT CASE
            WHEN ${this.uniques.table.visitorHash} <> ${UNIQUES_COLLAPSED_HASH}
            THEN ${this.uniques.table.day} || '|' || ${this.uniques.table.visitorHash}
          END)
          + COALESCE(SUM(CASE
            WHEN ${this.uniques.table.visitorHash} = ${UNIQUES_COLLAPSED_HASH}
            THEN ${this.uniques.table.count} ELSE 0
          END), 0) AS uniques
        FROM ${this.uniques.table}
        WHERE ${this.uniques.table.sigilId} IN (${this.scope(window)})
          AND ${this.uniques.table.day} >= ${window.since}
          ${
            window.until
              ? sql`AND ${this.uniques.table.day} <= ${window.until}`
              : sql``
          }
      `,
      z.object({ uniques: z.coerce.number() }),
    );
    return Number(row?.uniques) || 0;
  }

  protected scope(window: LoreAnalyticsWindow) {
    return sql.join(
      window.sigilIds.map((id) => sql`${id}`),
      sql`, `,
    );
  }
}
