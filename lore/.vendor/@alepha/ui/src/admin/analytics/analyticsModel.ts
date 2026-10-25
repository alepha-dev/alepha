import type {
  AdminAnalyticsQuery,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";

import type {
  AnalyticsFilterChip,
  AnalyticsQueryState,
  AnalyticsWindow,
} from "./analyticsTypes.ts";

/**
 * The four window lengths, in days. A length, not a pair of bounds: `until`
 * decides where the window ends.
 */
export const ANALYTICS_RANGES = [7, 14, 30, 90];

/**
 * The row caps the panel offers. The largest is also the API's own maximum
 * (`adminAnalyticsQuerySchema.limit`), which is what lets the group-count
 * probe saturate honestly instead of guessing.
 */
export const ANALYTICS_LIMITS = [50, 200, 1000];

export const ANALYTICS_MAX_LIMIT =
  ANALYTICS_LIMITS[ANALYTICS_LIMITS.length - 1];

const DAY_MS = 86_400_000;

/**
 * Fixed locale rather than the runtime's: the same number has to render the
 * same on the server and in the browser, or hydration tears.
 */
const numberFormat = new Intl.NumberFormat("en-US");

export const analyticsNumber = (value: number): string =>
  numberFormat.format(value);

export const analyticsCompact = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : value >= 10_000
      ? `${Math.round(value / 1000)}k`
      : numberFormat.format(value);

/**
 * UTC midnight of the day `nowMillis` falls in. Every bound in the query
 * language is a UTC day, so the local calendar never enters the arithmetic.
 */
export const analyticsToday = (nowMillis: number): number => {
  const now = new Date(nowMillis);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

export const analyticsIso = (millis: number): string =>
  new Date(millis).toISOString().slice(0, 10);

/**
 * The resolved window, `offset` windows back.
 *
 * `offset: 0` is the window under study and `offset: 1` its baseline, which
 * steps back by a whole window for `previous` and by a year for `lastYear`.
 * The end is the last COMPLETE day unless `until` says otherwise: a window
 * ending mid-day measured against a complete one reads as a collapse every
 * morning and recovers by evening.
 */
export const analyticsWindow = (
  todayMillis: number,
  state: Pick<AnalyticsQueryState, "days" | "untilMode" | "compare">,
  offset = 0,
): AnalyticsWindow => {
  const endOffset = state.untilMode === "today" ? 0 : 1;
  const shift = offset * (state.compare === "lastYear" ? 365 : state.days);
  const end = todayMillis - (endOffset + shift) * DAY_MS;
  return {
    from: analyticsIso(end - (state.days - 1) * DAY_MS),
    to: analyticsIso(end),
  };
};

/**
 * How many days of raw hour-bucketed rows the dataset keeps, or `null` when
 * it declares no hot window at all.
 *
 * `null` is not "zero": a dataset with no retention policy is never rolled
 * up, so every day of it is still hour-precise and `hour` must stay
 * unlocked.
 */
export const analyticsHotDays = (
  dataset: AdminDatasetDescriptor,
): number | null => {
  const hot = dataset.retention?.hot;
  if (!hot) return null;
  const match = /^(\d+)\s*([dhw])$/.exec(hot.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2] === "h") return Math.max(1, Math.round(value / 24));
  if (match[2] === "w") return value * 7;
  return value;
};

/**
 * `hour` survives only inside the hot window. Past it the rolled tier answers
 * in days while the raw tier answers in hours, and those are different keys:
 * they would not merge, so the answer would be plausible and wrong.
 */
export const analyticsHourAllowed = (
  dataset: AdminDatasetDescriptor,
  days: number,
): boolean => {
  const hot = analyticsHotDays(dataset);
  return hot === null || days <= hot;
};

/**
 * The groupBy actually sent. `hour` is stripped when locked: never send a key
 * you are telling the user is unavailable.
 */
export const analyticsEffectiveGroupBy = (
  dataset: AdminDatasetDescriptor,
  state: Pick<AnalyticsQueryState, "groupBy" | "days">,
): string[] =>
  analyticsHourAllowed(dataset, state.days)
    ? state.groupBy
    : state.groupBy.filter((key) => key !== "hour");

export const analyticsDimensions = (
  dataset: AdminDatasetDescriptor,
): string[] => Object.keys(dataset.dimensions?.properties ?? {});

export const analyticsMeasures = (dataset: AdminDatasetDescriptor): string[] =>
  Object.keys(dataset.measures?.properties ?? {});

export const analyticsActiveMeasures = (
  dataset: AdminDatasetDescriptor,
  state: Pick<AnalyticsQueryState, "measures">,
): string[] => {
  const declared = analyticsMeasures(dataset);
  const chosen = state.measures?.filter((name) => declared.includes(name));
  return chosen?.length ? chosen : declared;
};

/**
 * `30d hot · day · 400d`, skipping whatever the dataset left undeclared.
 */
export const analyticsRetentionLabel = (
  dataset: AdminDatasetDescriptor,
): string => {
  const retention = dataset.retention;
  if (!retention) return "";
  const parts: string[] = [];
  if (retention.hot) parts.push(`${retention.hot} hot`);
  if (retention.rollup) parts.push(retention.rollup);
  if (retention.cold) parts.push(retention.cold);
  return parts.join(" · ");
};

/**
 * The line under the `from` select: index, then the shape of the schema, then
 * retention. Everything a query has to respect, in one line.
 */
export const analyticsDatasetSummary = (
  dataset: AdminDatasetDescriptor,
): string => {
  const dims = analyticsDimensions(dataset).length;
  const measures = analyticsMeasures(dataset).length;
  // A one-measure dataset is not exotic (`sigil_vitals` is one), and "1
  // measures" in a line whose whole job is to be read at a glance is exactly
  // the kind of thing that makes a surface look unfinished.
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;
  return [
    dataset.index,
    plural(dims, "dim"),
    plural(measures, "measure"),
    analyticsRetentionLabel(dataset),
  ]
    .filter(Boolean)
    .join(" · ");
};

export const analyticsFilterLabel = (filter: AnalyticsFilterChip): string =>
  filter.values.length === 1
    ? `${filter.dim} = ${filter.values[0]}`
    : `${filter.dim} ∈ (${filter.values.length})`;

/**
 * `where` on the wire: one value is equality, several are `inArray`.
 */
export const analyticsWhere = (
  filters: AnalyticsFilterChip[],
): AdminAnalyticsQuery["where"] => {
  if (filters.length === 0) return undefined;
  const where: NonNullable<AdminAnalyticsQuery["where"]> = {};
  for (const filter of filters) {
    if (filter.values.length === 0) continue;
    where[filter.dim] =
      filter.values.length === 1
        ? filter.values[0]
        : { inArray: filter.values };
  }
  return Object.keys(where).length > 0 ? where : undefined;
};

/**
 * The default sort: chronological when a time grain is grouped, otherwise the
 * biggest group first. A top-N under a limit is only meaningful if the N are
 * the top ones.
 */
export const analyticsDefaultOrderBy = (
  groupBy: string[],
  primaryMeasure: string,
): { key: string; direction: "asc" | "desc" } =>
  groupBy.includes("day")
    ? { key: "day", direction: "asc" }
    : groupBy.includes("hour")
      ? { key: "hour", direction: "asc" }
      : { key: primaryMeasure, direction: "desc" };

/**
 * The body the panel would send. The request dialog renders this same object,
 * which is the design's honesty check: everything the UI can express is one
 * JSON object made only of published keys.
 */
export const analyticsRequestBody = (
  dataset: AdminDatasetDescriptor,
  state: AnalyticsQueryState,
  window: AnalyticsWindow,
): AdminAnalyticsQuery => {
  const measures = analyticsActiveMeasures(dataset, state);
  const groupBy = analyticsEffectiveGroupBy(dataset, state);
  return {
    since: window.from,
    until: window.to,
    where: analyticsWhere(state.filters),
    groupBy: groupBy.length > 0 ? groupBy : undefined,
    select: Object.fromEntries(measures.map((name) => [name, "sum" as const])),
    orderBy:
      state.orderBy ?? analyticsDefaultOrderBy(groupBy, measures[0] ?? ""),
    limit: state.limit,
  };
};

/**
 * Whether `advanced` holds anything that is not the default.
 *
 * `until` and `compare to` change the arithmetic, so neither can ever be
 * silently off-default: a dirty section states what changed, and forces
 * itself open. `limit` is included because it is part of the same summary,
 * though on its own it is safe to hide: the truncation banner surfaces it.
 */
export const analyticsAdvancedDirty = (state: AnalyticsQueryState): boolean =>
  state.untilMode !== "yesterday" ||
  state.compare !== "previous" ||
  state.limit !== 200;

/**
 * The next limit up from the current one, for the truncation banner's action.
 */
export const analyticsNextLimit = (limit: number): number =>
  ANALYTICS_LIMITS[
    Math.min(ANALYTICS_LIMITS.indexOf(limit) + 1, ANALYTICS_LIMITS.length - 1)
  ];
