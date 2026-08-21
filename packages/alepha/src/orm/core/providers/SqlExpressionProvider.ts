import { $inject } from "alepha";
import { type SQL, sql } from "drizzle-orm";

import { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

/**
 * Dialect-neutral SQL expression builder.
 *
 * Postgres stores timestamps as real timestamps; SQLite (and therefore
 * Cloudflare D1) stores them as epoch-millisecond integers. Every date
 * expression has to branch on that, which is why applications end up
 * hand-writing the same aggregation twice. These helpers emit the correct
 * fragment for the active dialect so the expression is written once.
 *
 * ```ts
 * class StatsController {
 *   protected readonly sqlx = $inject(SqlExpressionProvider);
 *   protected readonly database = $inject(DatabaseProvider);
 *   protected readonly quests = $repository(quests);
 *
 *   perDay = () => this.database.run(
 *     sql`SELECT ${this.sqlx.dateDay(this.quests.table.createdAt)} AS day,
 *                COUNT(*) AS total
 *         FROM ${this.quests.table} GROUP BY 1`,
 *     z.object({ day: z.text(), total: z.integer() }),
 *   );
 * }
 * ```
 */
export class SqlExpressionProvider {
  protected readonly database = $inject(DatabaseProvider);

  /**
   * Seconds per supported unit. Class-scoped so a subclass can extend the
   * set without a module-level constant.
   */
  protected static readonly UNIT_SECONDS: Record<SqlDateUnit, number> = {
    seconds: 1,
    minutes: 60,
    hours: 3600,
    days: 86400,
  };

  /**
   * True when the active dialect stores timestamps as epoch-millisecond
   * integers rather than native timestamps.
   */
  protected get isEpochMillis(): boolean {
    return this.database.dialect === "sqlite";
  }

  /**
   * Convert an epoch-millisecond column into the epoch-seconds value
   * SQLite's date functions expect.
   */
  protected toEpochSeconds(column: SqlLike): SQL {
    return sql`${column} / 1000`;
  }

  /**
   * A timestamp column truncated to its day, as sortable `'YYYY-MM-DD'` text.
   *
   * Returns text on both dialects on purpose: Postgres `DATE(col)` would
   * otherwise decode to a Date while SQLite yields a string, forcing callers
   * to declare two result schemas for one query.
   */
  public dateDay(column: SqlLike): SQL {
    if (this.isEpochMillis) {
      return sql`STRFTIME('%Y-%m-%d', ${this.toEpochSeconds(column)}, 'unixepoch')`;
    }
    return sql`TO_CHAR(${column}, 'YYYY-MM-DD')`;
  }

  /**
   * A timestamp column as a sortable ISO year-week label, e.g. `'2026-W11'`.
   *
   * SQLite has no ISO week function, so this uses the standard Thursday
   * trick: the ISO week of a date is the week containing the Thursday of that
   * date's Monday-started week, and the ISO year is that Thursday's calendar
   * year. `date(d, '-3 days', 'weekday 4')` lands on exactly that Thursday
   * for every day of the week, which is what makes the year-boundary cases
   * (a January date belonging to the previous ISO year, and vice versa) come
   * out right.
   */
  public dateWeek(column: SqlLike): SQL {
    if (this.isEpochMillis) {
      const thursday = sql`DATE(${this.toEpochSeconds(column)}, 'unixepoch', '-3 days', 'weekday 4')`;
      return sql`(
        STRFTIME('%Y', ${thursday})
        || '-W'
        || PRINTF('%02d', (CAST(STRFTIME('%j', ${thursday}) AS INTEGER) - 1) / 7 + 1)
      )`;
    }
    return sql`TO_CHAR(${column}, 'IYYY-"W"IW')`;
  }

  /**
   * Elapsed time between two timestamp columns, as a floating-point count of
   * `unit`.
   *
   * `NULL` on either side propagates rather than collapsing to zero, so this
   * composes with `AVG` over partially-complete rows the way callers expect
   * (an unfinished row is skipped, not averaged in as 0).
   *
   * The Postgres form is cast to `double precision` deliberately.
   * `EXTRACT(EPOCH …)` yields `numeric`, and the Postgres driver returns
   * `numeric` (and any `AVG` over it) as a **string** to protect precision —
   * so without the cast the same query decodes as a number on SQLite and a
   * string on Postgres, and every caller has to paper over the difference.
   */
  public dateDiff(end: SqlLike, start: SqlLike, unit: SqlDateUnit): SQL {
    const seconds = SqlExpressionProvider.UNIT_SECONDS[unit];
    if (this.isEpochMillis) {
      return sql`((${end} - ${start}) / ${sql.raw(String(seconds * 1000))}.0)`;
    }
    return sql`((EXTRACT(EPOCH FROM (${end} - ${start})) / ${sql.raw(String(seconds))}.0)::double precision)`;
  }

  /**
   * A timestamp `amount × unit` before now, directly comparable against a
   * timestamp column of the active dialect.
   *
   * Instant-aligned on both dialects, not midnight-aligned. Callers that want
   * calendar-day boundaries should bucket with {@link dateDay} rather than
   * relying on this — mixing the two is how a "last 7 days" window silently
   * means different things on different databases.
   */
  public ago(amount: number, unit: SqlDateUnit): SQL {
    const seconds = SqlExpressionProvider.UNIT_SECONDS[unit] * amount;
    if (this.isEpochMillis) {
      return sql`((STRFTIME('%s', 'now') - ${sql.raw(String(seconds))}) * 1000)`;
    }
    return sql`(NOW() - ${sql.raw(String(seconds))} * INTERVAL '1 second')`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Anything Drizzle accepts inside a `sql` template — a column, a nested
 * fragment, or a bound value.
 */
export type SqlLike = unknown;

/**
 * Units understood by the interval-shaped helpers.
 */
export type SqlDateUnit = "seconds" | "minutes" | "hours" | "days";
