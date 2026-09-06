import { $inject, z } from "alepha";
import { $repository, DatabaseProvider, sql } from "alepha/orm";

import {
  sigilUniquesDaily,
  UNIQUES_COLLAPSED_HASH,
} from "../entities/sigilUniquesDaily.ts";
import type { TrafficFilter } from "../schemas/trafficFilterSchema.ts";

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
  /**
   * `human` | `bot`. Omitted means `human`, which is what an app whose proxy
   * predates the stamp sends.
   */
  traffic?: string;
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
   * Which population to count. Omitted means `all`, so every caller that
   * predates the filter - the dashboard tiles, `DailyVisitorsService` - keeps
   * counting everyone.
   */
  traffic?: TrafficFilter;
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
        traffic: sample.traffic || "human",
      })),
      {
        // Four columns, matching the unique index exactly - an `ON CONFLICT`
        // target that does not name a real index is a runtime error, not a
        // wider match. Including `traffic` costs nothing in practice: the
        // hash closes over the user-agent the kind is derived from, so a
        // returning visitor conflicts on all four or none.
        target: ["sigilId", "day", "visitorHash", "traffic"],
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
  /**
   * The filter keys {@link uniqueVisitors} can actually narrow by.
   *
   * The uniques table is keyed `(sigilId, day, visitorHash)` and carries
   * `traffic`; every other dimension a view can be filtered by lives on the
   * `sigil_views` dataset and not here. `InsightsController` subtracts a
   * request's filters from this list and puts the remainder on the response as
   * `uniqueVisitorsIgnores`, so a count that is wider than the numbers beside
   * it says so rather than looking like one of them.
   *
   * Declared here, next to the table, because this is where the answer changes:
   * adding a dimension to `sigil_uniques_daily` (the way `traffic` was added in
   * 2026-08, with its own unique-index column and its own fold in
   * `SigilJobs.collapseUniques`) means adding it here and to `trafficClause`'s
   * neighbours, and the controller then narrows by it with no edit of its own.
   */
  public static readonly FILTERS = ["sigilId", "traffic"];

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
          ${this.trafficClause(window.traffic)}
      `,
      z.object({ uniques: z.coerce.number() }),
    );
    return Number(row?.uniques) || 0;
  }

  /**
   * The `AND traffic …` term, or nothing at all for `all`.
   *
   * `humans` is expressed as **not a bot** rather than as an equality, which
   * is the honest definition and the one that survives a value nobody has
   * thought of yet: an unclassified row is a person, and so is a row carrying
   * a kind this code has never heard of.
   *
   * Worth noting that the view filter in `InsightsController` cannot do this
   * and enumerates the positive side instead. Not an inconsistency: that one
   * goes through `AnalyticsFilter`, which deliberately offers equality and set
   * membership only, on a seam two backends have to honour. This is SQL
   * against one table.
   */
  protected trafficClause(traffic: TrafficFilter | undefined) {
    if (traffic === "bots") {
      return sql`AND ${this.uniques.table.traffic} = ${"bot"}`;
    }
    if (traffic === "humans") {
      return sql`AND ${this.uniques.table.traffic} <> ${"bot"}`;
    }
    return sql``;
  }

  /**
   * The app set, as ONE bound parameter rather than one per app.
   *
   * ⚠️ **This table is D1 in production, and D1 refuses a statement carrying
   * more than 100 bound parameters** (probed in folio #F1173: 100 ok, 101
   * fails). The obvious `IN (?, ?, …)` binds one per sigil, so a project with
   * 101 apps got a failed Insights page and a failed dashboard tile, with no
   * error anyone reads until then. Apps v3 makes one sigil per instance
   * normal, so a project with several environments reaches the ceiling long
   * before it has a hundred apps.
   *
   * The ids ride inside a single JSON array parameter and are unpacked by
   * `json_each`, which SQLite and D1 both provide (a Lore migration already
   * uses it over `projects.areas`). One parameter whatever the list's length,
   * and the query keeps its exact meaning.
   *
   * Chunking, the other way out of the ceiling, is **wrong here** and it is
   * worth saying why: `uniqueVisitors` counts DISTINCT `(day, visitorHash)`
   * across the whole set precisely so one person visiting two of a project's
   * apps counts once. Summing per-chunk counts would count them twice, which
   * is the exact error this class exists to avoid. A chunked merge is fine for
   * a read whose rows each belong to one sigil — `InsightsController`'s error
   * groups do it — and never for a distinct count.
   */
  protected scope(window: LoreAnalyticsWindow) {
    return sql`SELECT value FROM json_each(${JSON.stringify(window.sigilIds)})`;
  }
}
