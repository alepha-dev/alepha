import type { AdminAnalyticsQuery } from "alepha/api/analytics";

/**
 * Where the window ends. `yesterday` is the last complete UTC day; `today`
 * includes the bucket that is still filling, which is why the chart ghosts
 * its final bar.
 */
export type AnalyticsUntilMode = "yesterday" | "today";

/**
 * The baseline every delta is measured against. `off` hides deltas rather
 * than inventing one.
 */
export type AnalyticsCompareMode = "previous" | "lastYear" | "off";

export type AnalyticsView = "overview" | "table";

export type AnalyticsChartShape =
  | "bars"
  | "line"
  | "share"
  | "rank"
  | "donut"
  | "heat";

/**
 * One `where` clause: a dimension and the values it is pinned to. One value
 * serialises to equality, several to `inArray`.
 */
export interface AnalyticsFilterChip {
  dim: string;
  values: string[];
}

export interface AnalyticsWindow {
  from: string;
  to: string;
}

export type AnalyticsRow = Record<string, string | number>;

export interface AnalyticsOrderBy {
  key: string;
  direction: "asc" | "desc";
}

/**
 * Everything the query panel edits. Split from the display-only state (view,
 * shape, axis, chart measure) because only these fields reach the wire: a
 * change here re-runs the query, a change there re-renders the same result.
 */
export interface AnalyticsQueryState {
  dataset: string;
  days: number;
  untilMode: AnalyticsUntilMode;
  compare: AnalyticsCompareMode;
  groupBy: string[];
  filters: AnalyticsFilterChip[];
  limit: number;
  /**
   * `null` means "every measure the dataset declares". Kept as null rather
   * than a copied list, so a dataset switch cannot leave a measure name
   * behind that the new schema has never heard of.
   */
  measures: string[] | null;
  orderBy: AnalyticsOrderBy | null;
}

/**
 * One run, and every number the results pane shows.
 *
 * `totals` comes from its own ungrouped query rather than from summing
 * `rows`: the truncation banner promises that the cards still cover every
 * group while the table does not, and that promise is only true if the two
 * are measured separately.
 */
export interface AnalyticsRunResult {
  rows: AnalyticsRow[];
  /**
   * How many groups the query matched, before `limit`. Read from a companion
   * query capped at the API maximum, so it saturates rather than lying.
   */
  groupCount: number;
  /**
   * `true` when `groupCount` hit that cap and the real population is larger.
   */
  groupCountCapped: boolean;
  totals: Record<string, number>;
  baseline: Record<string, number> | null;
  estimated: boolean;
  sampleInterval?: number;
  window: AnalyticsWindow;
  baselineWindow: AnalyticsWindow | null;
  groupBy: string[];
  measures: string[];
  orderBy: AnalyticsOrderBy;
  limit: number;
  /**
   * The exact body that produced `rows`. What the request dialog shows, so
   * the dialog cannot drift from what was sent.
   */
  body: AdminAnalyticsQuery;
}
