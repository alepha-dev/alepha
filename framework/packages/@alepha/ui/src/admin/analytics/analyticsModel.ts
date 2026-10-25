import type {
  AdminAnalyticsQuery,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";

import type {
  AnalyticsFilterChip,
  AnalyticsInstantRange,
  AnalyticsQueryState,
  AnalyticsTimeGrain,
  AnalyticsWindow,
} from "./analyticsTypes.ts";

/**
 * The four window lengths, in days. A length, not a pair of bounds: `until`
 * decides where the window ends.
 */
export const ANALYTICS_RANGES = [7, 14, 30, 90];

/**
 * The relative windows, in minutes, sent as `from`/`to` instants: what a
 * monitoring view asks for.
 */
export const ANALYTICS_RELATIVE_RANGES = [
  { minutes: 15, label: "15m" },
  { minutes: 60, label: "1h" },
  { minutes: 360, label: "6h" },
  { minutes: 1440, label: "24h" },
  { minutes: 10_080, label: "7d" },
];

/**
 * The most buckets one chart draws. A time grain that would draw more over
 * the window is not offered: a thousand bars are a texture, not a chart.
 */
export const ANALYTICS_MAX_POINTS = 500;

const MINUTE_MS = 60_000;

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
 * Minutes per bucket of a resolution (`1m` … `1d`).
 */
export const analyticsResolutionMinutes = (resolution: string): number =>
  ({ "1m": 1, "5m": 5, "15m": 15, "1h": 60, "1d": 1440 })[resolution] ?? 60;

/**
 * A retention window (`48h`, `30d`, `90m`) in milliseconds, or `null` when it
 * does not parse.
 */
export const analyticsWindowMillis = (spec: string): number | null => {
  const match = /^(\d+)([mhd])$/.exec(spec.trim());
  if (!match) return null;
  const unit = { m: MINUTE_MS, h: 60 * MINUTE_MS, d: DAY_MS }[
    match[2] as "m" | "h" | "d"
  ];
  return Number(match[1]) * unit;
};

/**
 * The time grains the dataset can group by: `minute` only below an hour.
 */
export const analyticsTimeGrains = (
  dataset: AdminDatasetDescriptor,
): AnalyticsTimeGrain[] =>
  analyticsResolutionMinutes(dataset.resolution) < 60
    ? ["minute", "hour", "day"]
    : ["hour", "day"];

export const analyticsIsTimeGrain = (key: string): key is AnalyticsTimeGrain =>
  key === "minute" || key === "hour" || key === "day";

export const analyticsGrainMillis = (
  dataset: AdminDatasetDescriptor,
  grain: AnalyticsTimeGrain,
): number =>
  grain === "day"
    ? DAY_MS
    : grain === "hour"
      ? 60 * MINUTE_MS
      : analyticsResolutionMinutes(dataset.resolution) * MINUTE_MS;

/**
 * The oldest instant at which `grain` is still exact, or `null` when it always
 * is. A grain reads exact keys only from tiers no coarser than itself; older
 * rows sit in coarser buckets, which come back under the same key with a
 * coarser value and would not merge with the rest. The coarsest such tier
 * keeps the longest, until the sweep folds it on a bucket of the next tier.
 */
export const analyticsGrainReach = (
  dataset: AdminDatasetDescriptor,
  grain: AnalyticsTimeGrain,
  nowMillis: number,
): number | null => {
  const tiers = dataset.retention ?? [];
  const limit = analyticsGrainMillis(dataset, grain) / MINUTE_MS;
  let index = -1;
  for (let i = 0; i < tiers.length; i++) {
    if (analyticsResolutionMinutes(tiers[i].resolution) <= limit) index = i;
  }
  const tier = tiers[index];
  if (!tier?.keep) return null;
  const keep = analyticsWindowMillis(tier.keep);
  if (keep === null) return null;
  const next = tiers[index + 1];
  const step = next
    ? analyticsResolutionMinutes(next.resolution) * MINUTE_MS
    : MINUTE_MS;
  return Math.floor((nowMillis - keep) / step) * step;
};

/**
 * The window as two instants, `end` exclusive.
 */
export const analyticsSpan = (
  window: AnalyticsWindow,
): { start: number; end: number } =>
  window.instant
    ? { start: Date.parse(window.from), end: Date.parse(window.to) }
    : {
        start: Date.parse(`${window.from}T00:00:00.000Z`),
        end: Date.parse(`${window.to}T00:00:00.000Z`) + DAY_MS,
      };

/**
 * Why `grain` cannot be grouped by over `window`, or `null` when it can:
 * `retention` when the window starts before the grain is exact, `points`
 * when it would draw more than {@link ANALYTICS_MAX_POINTS} buckets.
 */
export const analyticsGrainLock = (
  dataset: AdminDatasetDescriptor,
  grain: AnalyticsTimeGrain,
  window: AnalyticsWindow,
  nowMillis: number,
): "retention" | "points" | null => {
  const span = analyticsSpan(window);
  const reach = analyticsGrainReach(dataset, grain, nowMillis);
  if (reach !== null && span.start < reach) return "retention";
  const points = Math.ceil(
    (span.end - span.start) / analyticsGrainMillis(dataset, grain),
  );
  return points > ANALYTICS_MAX_POINTS ? "points" : null;
};

/**
 * The finest grain the window allows: the chart's default x-axis.
 */
export const analyticsDefaultGrain = (
  dataset: AdminDatasetDescriptor,
  window: AnalyticsWindow,
  nowMillis: number,
): AnalyticsTimeGrain | null =>
  analyticsTimeGrains(dataset).find(
    (grain) => analyticsGrainLock(dataset, grain, window, nowMillis) === null,
  ) ?? null;

/**
 * The groupBy actually sent. A locked grain is never sent: it is replaced by
 * the finest grain the window allows, so a monitoring range keeps a time
 * axis, or dropped when none is allowed or that one is already there.
 */
export const analyticsEffectiveGroupBy = (
  dataset: AdminDatasetDescriptor,
  state: Pick<AnalyticsQueryState, "groupBy">,
  window: AnalyticsWindow,
  nowMillis: number,
): string[] => {
  const out: string[] = [];
  for (const key of state.groupBy) {
    if (!analyticsIsTimeGrain(key)) {
      out.push(key);
      continue;
    }
    const usable =
      analyticsGrainLock(dataset, key, window, nowMillis) === null
        ? key
        : analyticsDefaultGrain(dataset, window, nowMillis);
    if (usable && !out.includes(usable)) out.push(usable);
  }
  return out;
};

/**
 * An instant as ISO 8601 with the browser's own offset at that instant,
 * `2026-10-18T08:00:00+04:00`: what `from`/`to` must carry.
 */
export const analyticsInstantIso = (millis: number): string => {
  const offset = -new Date(millis).getTimezoneOffset();
  const local = new Date(millis + offset * MINUTE_MS)
    .toISOString()
    .slice(0, 19);
  const sign = offset < 0 ? "-" : "+";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${local}${sign}${hours}:${minutes}`;
};

/**
 * An instant window, `offset` windows back: `previous` steps back by its own
 * length, `lastYear` by 365 days. A relative range ends at the current
 * minute; an absolute one is the two instants picked.
 */
export const analyticsInstantWindow = (
  nowMillis: number,
  instant: AnalyticsInstantRange,
  compare: AnalyticsQueryState["compare"],
  offset = 0,
): AnalyticsWindow => {
  let start: number;
  let end: number;
  if (instant.kind === "relative") {
    end = Math.floor(nowMillis / MINUTE_MS) * MINUTE_MS;
    start = end - instant.minutes * MINUTE_MS;
  } else {
    start = new Date(instant.from).getTime();
    end = new Date(instant.to).getTime();
  }
  const shift = offset * (compare === "lastYear" ? 365 * DAY_MS : end - start);
  return {
    from: analyticsInstantIso(start - shift),
    to: analyticsInstantIso(end - shift),
    instant: true,
  };
};

/**
 * The window under study (`offset: 0`) or its baseline (`offset: 1`),
 * whichever form the state holds.
 */
export const analyticsStateWindow = (
  nowMillis: number,
  state: Pick<
    AnalyticsQueryState,
    "days" | "untilMode" | "compare" | "instant"
  >,
  offset = 0,
): AnalyticsWindow =>
  state.instant
    ? analyticsInstantWindow(nowMillis, state.instant, state.compare, offset)
    : analyticsWindow(analyticsToday(nowMillis), state, offset);

/**
 * How a window reads in the explorer: days as they are, instants as local
 * `YYYY-MM-DD HH:MM`.
 */
export const analyticsWindowLabel = (window: AnalyticsWindow): string => {
  const ends = analyticsWindowEnds(window);
  return `${ends.from} → ${ends.to}`;
};

/**
 * Both ends of a window as {@link analyticsWindowLabel} prints them.
 */
export const analyticsWindowEnds = (
  window: AnalyticsWindow,
): { from: string; to: string } => {
  if (!window.instant) return { from: window.from, to: window.to };
  const local = (iso: string) => iso.slice(0, 16).replace("T", " ");
  return { from: local(window.from), to: local(window.to) };
};

/**
 * The length of a window, as the cards and notes name it: `30d`, `6h`,
 * `15m`.
 */
export const analyticsSpanLabel = (window: AnalyticsWindow): string => {
  const { start, end } = analyticsSpan(window);
  const minutes = Math.round((end - start) / MINUTE_MS);
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
};

export const analyticsDimensions = (
  dataset: AdminDatasetDescriptor,
): string[] => Object.keys(dataset.dimensions?.properties ?? {});

/**
 * The folds a measure declares; `["sum"]` when the descriptor says nothing.
 */
export const analyticsFolds = (
  dataset: AdminDatasetDescriptor,
  measure: string,
): string[] => dataset.folds?.[measure] ?? ["sum"];

export const analyticsSumOnly = (
  dataset: AdminDatasetDescriptor,
  measure: string,
): boolean => {
  const folds = analyticsFolds(dataset, measure);
  return folds.length === 1 && folds[0] === "sum";
};

/**
 * Every value the dataset can be asked for, by the key it comes back under:
 * a sum-only measure's own name, or `<measure>_<fold>` per declared fold.
 */
export const analyticsMeasures = (dataset: AdminDatasetDescriptor): string[] =>
  Object.keys(dataset.measures?.properties ?? {}).flatMap((measure) =>
    analyticsSumOnly(dataset, measure)
      ? [measure]
      : analyticsFolds(dataset, measure).map((fold) => `${measure}_${fold}`),
  );

/**
 * The measure and the fold behind a value key.
 */
export const analyticsKeyFold = (
  dataset: AdminDatasetDescriptor | undefined,
  key: string,
): { measure: string; fold: string } => {
  for (const measure of Object.keys(dataset?.measures?.properties ?? {})) {
    if (key === measure) return { measure, fold: "sum" };
    if (!dataset) break;
    for (const fold of analyticsFolds(dataset, measure)) {
      if (key === `${measure}_${fold}`) return { measure, fold };
    }
  }
  return { measure: key, fold: "sum" };
};

/**
 * `sum(views)`, `max(temperature)`: how a value is named everywhere it shows.
 */
export const analyticsKeyLabel = (
  dataset: AdminDatasetDescriptor | undefined,
  key: string,
): string => {
  const { measure, fold } = analyticsKeyFold(dataset, key);
  return `${fold}(${measure})`;
};

/**
 * `select` on the wire for the chosen keys: `"sum"` for a sum-only measure,
 * the array of chosen folds for a gauge, so its keys come back as
 * `<measure>_<fold>` and a band chart is one query.
 */
export const analyticsSelect = (
  dataset: AdminDatasetDescriptor,
  keys: string[],
): AdminAnalyticsQuery["select"] => {
  const select: Record<string, "sum" | Array<"sum" | "min" | "max" | "last">> =
    {};
  for (const key of keys) {
    const { measure, fold } = analyticsKeyFold(dataset, key);
    if (analyticsSumOnly(dataset, measure)) {
      select[measure] = "sum";
      continue;
    }
    const current = select[measure];
    const folds = Array.isArray(current) ? current : [];
    folds.push(fold as "sum" | "min" | "max" | "last");
    select[measure] = folds;
  }
  return select;
};

export const analyticsActiveMeasures = (
  dataset: AdminDatasetDescriptor,
  state: Pick<AnalyticsQueryState, "measures">,
): string[] => {
  const declared = analyticsMeasures(dataset);
  const chosen = state.measures?.filter((name) => declared.includes(name));
  return chosen?.length ? chosen : declared;
};

/**
 * `1m 48h · 1h 30d · 1d 400d`: each tier's resolution and how long it keeps,
 * `∞` where it keeps forever.
 */
export const analyticsRetentionLabel = (
  dataset: AdminDatasetDescriptor,
): string => {
  const tiers = dataset.retention ?? [];
  if (!tiers.some((tier) => tier.keep)) return "";
  return tiers
    .map((tier) => `${tier.resolution} ${tier.keep ?? "∞"}`)
    .join(" · ");
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
): { key: string; direction: "asc" | "desc" } => {
  const grain = groupBy.find(analyticsIsTimeGrain);
  return grain
    ? { key: grain, direction: "asc" }
    : { key: primaryMeasure, direction: "desc" };
};

/**
 * The body the panel would send. The request dialog renders this same object,
 * which is the design's honesty check: everything the UI can express is one
 * JSON object made only of published keys.
 */
export const analyticsRequestBody = (
  dataset: AdminDatasetDescriptor,
  state: AnalyticsQueryState,
  window: AnalyticsWindow,
  nowMillis: number,
): AdminAnalyticsQuery => {
  const measures = analyticsActiveMeasures(dataset, state);
  const groupBy = analyticsEffectiveGroupBy(dataset, state, window, nowMillis);
  return {
    ...analyticsWindowBody(window),
    where: analyticsWhere(state.filters),
    groupBy: groupBy.length > 0 ? groupBy : undefined,
    select: analyticsSelect(dataset, measures),
    orderBy:
      state.orderBy ?? analyticsDefaultOrderBy(groupBy, measures[0] ?? ""),
    limit: state.limit,
  };
};

/**
 * The keys a `select` comes back under: the measure for one fold,
 * `<measure>_<fold>` for each of an array.
 */
export const analyticsSelectKeys = (
  select: AdminAnalyticsQuery["select"],
): string[] =>
  Object.entries(select).flatMap(([measure, folds]) =>
    Array.isArray(folds)
      ? folds.map((fold) => `${measure}_${fold}`)
      : [measure],
  );

/**
 * The window's half of a request body: `since`/`until` for days,
 * `from`/`to` for instants.
 */
export const analyticsWindowBody = (
  window: AnalyticsWindow,
): Pick<AdminAnalyticsQuery, "since" | "until" | "from" | "to"> =>
  window.instant
    ? { from: window.from, to: window.to }
    : { since: window.from, until: window.to };

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
