import type { ZObject } from "alepha";

import type { AnalyticsFilter } from "./analyticsQuerySchema.ts";

/**
 * An event log as declared: one stored row per event, never folded.
 *
 * Where a dataset (`$analytics`) keeps a sum per bucket forever, an event
 * log keeps every row for a bounded time, which is what lets it count
 * distinct values exactly under any combination of filters.
 */
export interface AnalyticsEventLog {
  /**
   * Storage-facing name, snake_case. The relational table is
   * `analytics_<name>_events`.
   */
  name: string;
  /**
   * The column nearly every query filters on (an app, a tenant). The
   * relational table is indexed on `(index, time)`.
   */
  index: string;
  /**
   * The columns of a row. Strings, numbers and booleans; a column that may
   * hold no value is declared `.nullable().optional()`, which is what makes
   * it a nullable column on a relational backend. The time of the event is not a column here: it is `at` on the
   * appended row.
   */
  schema: ZObject;
  /**
   * How long a row is kept: `<n>d` or `<n>h`. A row older than this is
   * refused on append and deleted by the hourly sweep.
   */
  keep: string;
}

/**
 * One event as appended: every column of the schema, and optionally `at`,
 * the instant it happened (millis, default now).
 */
export type EventLogRow = Record<string, string | number | boolean | null> & {
  at?: number;
};

/**
 * One event as stored: `at` is always set.
 */
export type EventLogStoredRow = Record<
  string,
  string | number | boolean | null
> & { at: number };

/**
 * A time grain a query may group by, all UTC. `week` is the ISO week,
 * starting Monday, keyed by that Monday's date; `month` is keyed `YYYY-MM`.
 */
export type EventLogGrain = "hour" | "day" | "week" | "month";

/**
 * What a selected value computes over the rows of its group.
 *
 * - `count`: the rows (`"*"`), or the rows where a column is not null.
 * - `sum`, `min`, `max`: over a numeric column, nulls ignored; `null` when
 *   the group holds no value.
 * - `distinct`: how many different non-null values a column takes, exactly.
 */
export type EventLogMeasure =
  | { count: string }
  | { sum: string }
  | { min: string }
  | { max: string }
  | { distinct: string };

export interface EventLogQuery {
  /**
   * First UTC day included, `YYYY-MM-DD`. Exactly one of `since` and `from`.
   */
  since?: string;
  /**
   * Last UTC day included, `YYYY-MM-DD`; pairs with `since`.
   */
  until?: string;
  /**
   * First instant included, ISO 8601 with an offset. Exactly one of `since`
   * and `from`.
   */
  from?: string;
  /**
   * First instant excluded, same form as `from`; pairs with `from`.
   */
  to?: string;
  /**
   * Equality and set membership on columns, as for a dataset.
   */
  where?: AnalyticsFilter;
  /**
   * Columns, and the time grains `hour`, `day`, `week` and `month`.
   */
  groupBy?: Array<string>;
  /**
   * One returned key per entry: `{ visitors: { distinct: "sessionId" } }`.
   */
  select: Record<string, EventLogMeasure>;
  /**
   * `key` is a grouped column or grain, or a selected key.
   */
  orderBy?: { key: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface EventLogResult {
  rows: Array<Record<string, string | number | boolean | null>>;
  /**
   * Always `false`: every backend that holds an event log stores every row.
   */
  estimated: false;
}
