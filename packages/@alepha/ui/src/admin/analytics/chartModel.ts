import type {
  AnalyticsChartShape,
  AnalyticsRow,
  AnalyticsUntilMode,
} from "./analyticsTypes.ts";

/**
 * How many categorical groups a ranking or a donut draws. Chronological
 * shapes are never capped: their axis is the window itself, and dropping the
 * tail of it would be a silent lie about the shape of the series.
 */
export const ANALYTICS_TOP_N = 12;

/**
 * Distinct breakdown series before the rest folds into `other`.
 */
export const ANALYTICS_SLOTS = 5;

export interface AnalyticsChartSegment {
  slot: string;
  value: number;
}

export interface AnalyticsChartPoint {
  key: string;
  /**
   * Axis label. Bucket keys are `YYYY-MM-DD` / `YYYY-MM-DDTHH`, which are too
   * long for a tick, so the year is dropped.
   */
  label: string;
  value: number;
  share: number;
  /**
   * The min-max band behind the line, when the chart draws a gauge whose
   * `min` and `max` are both selected.
   */
  band?: { low: number; high: number };
  segments: AnalyticsChartSegment[];
  /**
   * The newest bucket when the window runs to today: still filling, so it is
   * drawn ghosted rather than read as a drop.
   */
  partial: boolean;
}

export interface AnalyticsHeatCell {
  hour: number;
  value: number;
  intensity: number;
}

export interface AnalyticsHeatRow {
  day: string;
  label: string;
  total: number;
  cells: AnalyticsHeatCell[];
}

export interface AnalyticsChartModel {
  measure: string;
  /**
   * Whether the points carry a min-max band (see `AnalyticsChartPoint.band`).
   */
  banded: boolean;
  shape: AnalyticsChartShape;
  available: AnalyticsChartShape[];
  xKey: string;
  breakdown: string | null;
  timeKey: string | null;
  chronological: boolean;
  /**
   * Grouped keys this shape sums over rather than draws. Named in the chart's
   * note, because a ranking of `category` that quietly folded `country` looks
   * exactly like one that never had it.
   */
  collapsed: string[];
  slots: string[];
  points: AnalyticsChartPoint[];
  max: number;
  total: number;
  seriesLength: number;
  heat: AnalyticsHeatRow[] | null;
}

export interface AnalyticsChartInput {
  rows: AnalyticsRow[];
  groupBy: string[];
  measures: string[];
  /**
   * The fold behind each value key; `sum` when absent.
   */
  folds?: Record<string, string>;
  measure: string | null;
  axis: string | null;
  shape: AnalyticsChartShape | null;
  untilMode: AnalyticsUntilMode;
}

/**
 * The colours a breakdown's series wear, in order.
 *
 * The theme's own chart ramp, with `muted-foreground` last so the `other`
 * bucket reads as the leftovers it is rather than as a sixth peer.
 */
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

export const analyticsSlotColor = (index: number): string =>
  SERIES_COLORS[Math.min(Math.max(index, 0), SERIES_COLORS.length - 1)];

/**
 * A collision-free identity for one combination of key values.
 *
 * `JSON.stringify` of the list rather than a joined string: two dimension
 * values that differ only by where a separator falls would otherwise land in
 * the same bucket, and every separator character is a legal value here.
 */
const groupId = (row: AnalyticsRow, keys: string[]): string =>
  JSON.stringify(keys.map((key) => String(row[key])));

/**
 * Re-fold the result rows onto a narrower set of keys.
 *
 * The backend already grouped by every key the query asked for; a chart only
 * ever draws one or two of them, so the rest are folded here rather than
 * re-queried, each value by its own fold: sums add, a `min` keeps the lowest
 * and a `max` the highest, a missing reading (`null`) counting as absent. A
 * `last` folded over several groups has no answer without the instant of
 * each reading, which the result does not carry, so it becomes `null` rather
 * than a guess.
 */
export const analyticsAggregate = (
  rows: AnalyticsRow[],
  keys: string[],
  measures: string[],
  folds: Record<string, string> = {},
): AnalyticsRow[] => {
  const groups = new Map<string, { row: AnalyticsRow; count: number }>();
  for (const row of rows) {
    const id = groupId(row, keys);
    let group = groups.get(id);
    if (!group) {
      const created: AnalyticsRow = {};
      for (const key of keys) created[key] = row[key];
      for (const measure of measures) {
        created[measure] = (folds[measure] ?? "sum") === "sum" ? 0 : null;
      }
      group = { row: created, count: 0 };
      groups.set(id, group);
    }
    group.count++;
    for (const measure of measures) {
      const fold = folds[measure] ?? "sum";
      const current = group.row[measure];
      const value = row[measure];
      if (fold === "sum") {
        group.row[measure] = Number(current) + Number(value ?? 0);
      } else if (fold === "last") {
        group.row[measure] = group.count === 1 ? (value ?? null) : null;
      } else if (value !== null && value !== undefined) {
        const reading = Number(value);
        group.row[measure] =
          current === null || current === undefined
            ? reading
            : fold === "min"
              ? Math.min(Number(current), reading)
              : Math.max(Number(current), reading);
      }
    }
  }
  return [...groups.values()].map((group) => group.row);
};

const isTimeGrain = (key: string): boolean =>
  key === "day" || key === "hour" || key === "minute";

/**
 * `2026-08-21` becomes `08-21`, `2026-08-21T14` becomes `08-21 14h`. The year
 * is constant across every window this UI can express, so on an axis it is
 * only noise.
 */
const axisLabel = (key: string, value: string): string => {
  if (key === "day") return value.slice(5);
  if (key === "hour") return `${value.slice(5).replace("T", " ")}h`;
  if (key === "minute") return value.slice(5).replace("T", " ");
  return value;
};

/**
 * Which shapes the current grouping actually supports.
 *
 * The picker only offers these, and a saved shape the query no longer
 * supports falls back to the first available one rather than erroring. Every
 * rule here is a refusal to draw a misleading picture: a line needs an
 * ordered axis, a 100% share needs something to divide, a donut needs few
 * enough slices to read as parts of one whole.
 */
export const analyticsAvailableShapes = (input: {
  groupBy: string[];
  chronological: boolean;
  breakdown: string | null;
  seriesLength: number;
}): AnalyticsChartShape[] => {
  const heatable =
    input.groupBy.includes("day") &&
    input.groupBy.includes("hour") &&
    input.chronological;
  if (heatable) return ["heat", "bars", "line"];
  if (input.chronological) {
    return input.breakdown ? ["bars", "line", "share"] : ["bars", "line"];
  }
  return input.seriesLength <= 8 ? ["rank", "donut"] : ["rank"];
};

/**
 * The grouped keys the shape does not draw.
 *
 * A heatmap plots both time keys as its axes; bars and 100% share plot the
 * breakdown; everything else draws the x-axis alone.
 */
export const analyticsCollapsedKeys = (
  groupBy: string[],
  xKey: string,
  shape: AnalyticsChartShape,
  breakdown: string | null,
): string[] => {
  const plotted = new Set([xKey]);
  if (shape === "heat") {
    plotted.add("day");
    plotted.add("hour");
  }
  if (breakdown && (shape === "bars" || shape === "share")) {
    plotted.add(breakdown);
  }
  return groupBy.filter((key) => !plotted.has(key));
};

/**
 * Day rows by hour-of-day columns.
 *
 * Built from the `hour` bucket key alone: it is `YYYY-MM-DDTHH`, so the day
 * is its own prefix and both axes come out of one key, without trusting a
 * separate `day` column to agree with it.
 */
export const analyticsHeatRows = (
  rows: AnalyticsRow[],
  measure: string,
): AnalyticsHeatRow[] => {
  const grid = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const bucket = String(row.hour ?? "");
    if (bucket.length < 13) continue;
    const day = bucket.slice(0, 10);
    const hour = Number(bucket.slice(11, 13));
    const byHour = grid.get(day) ?? new Map<number, number>();
    byHour.set(hour, (byHour.get(hour) ?? 0) + Number(row[measure] ?? 0));
    grid.set(day, byHour);
  }
  let max = 1;
  for (const byHour of grid.values()) {
    for (const value of byHour.values()) max = Math.max(max, value);
  }
  return [...grid.keys()]
    .sort()
    .slice(-16)
    .map((day) => {
      const byHour = grid.get(day) ?? new Map<number, number>();
      let total = 0;
      const cells = Array.from({ length: 24 }, (_, hour) => {
        const value = byHour.get(hour) ?? 0;
        total += value;
        return {
          hour,
          value,
          intensity: value === 0 ? 0.06 : 0.16 + (value / max) * 0.84,
        };
      });
      return { day, label: day.slice(5), total, cells };
    });
};

/**
 * Everything the chart draws, folded out of one result.
 *
 * Nothing here re-queries: the shapes are all views of the same rows, so
 * switching between them cannot show two different numbers for one thing.
 */
export const analyticsChartModel = (
  input: AnalyticsChartInput,
): AnalyticsChartModel => {
  const folds = input.folds ?? {};
  const chosen =
    input.measure && input.measures.includes(input.measure)
      ? input.measure
      : (input.measures[0] ?? "");
  // A gauge whose min and max are both selected draws as a band, with its
  // last reading (when selected) as the line through it.
  const gauge = analyticsGaugeKeys(chosen, input.measures, folds);
  const measure = gauge?.last ?? chosen;
  const gaugeFold = (folds[measure] ?? "sum") !== "sum";

  const timeKey = input.groupBy.find(isTimeGrain) ?? null;
  const xKey =
    input.axis && input.groupBy.includes(input.axis)
      ? input.axis
      : (timeKey ?? input.groupBy[0] ?? "day");
  const chronological = isTimeGrain(xKey);
  const breakdown =
    input.groupBy.find((key) => key !== xKey && !isTimeGrain(key)) ?? null;

  const series = analyticsAggregate(
    input.rows,
    [xKey],
    gauge ? [measure, gauge.min, gauge.max] : [measure],
    folds,
  );
  series.sort((left, right) =>
    chronological
      ? String(left[xKey]).localeCompare(String(right[xKey]))
      : Number(right[measure]) - Number(left[measure]),
  );
  const shown = chronological ? series : series.slice(0, ANALYTICS_TOP_N);

  // A gauge has no share of a total and no stack: a line (or bars) over
  // time, or a ranking.
  const available: AnalyticsChartShape[] = gaugeFold
    ? chronological
      ? ["line", "bars"]
      : ["rank"]
    : analyticsAvailableShapes({
        groupBy: input.groupBy,
        chronological,
        breakdown,
        seriesLength: series.length,
      });
  const shape =
    input.shape && available.includes(input.shape) ? input.shape : available[0];

  // Only bars and 100% share draw the breakdown; every other shape sums
  // across it, and says so in its note.
  const stacked = !!breakdown && (shape === "bars" || shape === "share");

  let slots: string[] = [];
  const cross = new Map<string, number>();
  if (stacked && breakdown) {
    const byValue = analyticsAggregate(input.rows, [breakdown], [measure]);
    byValue.sort(
      (left, right) => Number(right[measure]) - Number(left[measure]),
    );
    const top = byValue
      .slice(0, ANALYTICS_SLOTS)
      .map((row) => String(row[breakdown]));
    slots = byValue.length > top.length ? [...top, "other"] : top;
    for (const row of analyticsAggregate(
      input.rows,
      [xKey, breakdown],
      [measure],
    )) {
      const value = String(row[breakdown]);
      const slot = top.includes(value) ? value : "other";
      const id = JSON.stringify([String(row[xKey]), slot]);
      cross.set(id, (cross.get(id) ?? 0) + Number(row[measure]));
    }
  }

  const total = series.reduce((sum, row) => sum + Number(row[measure] ?? 0), 0);
  const max = Math.max(
    1,
    ...shown.map((row) =>
      Math.max(
        Number(row[measure] ?? 0),
        gauge ? Number(row[gauge.max] ?? 0) : 0,
      ),
    ),
  );

  const points: AnalyticsChartPoint[] = shown.map((row, index) => {
    const key = String(row[xKey]);
    const value = Number(row[measure] ?? 0);
    const low = gauge ? row[gauge.min] : null;
    const high = gauge ? row[gauge.max] : null;
    return {
      key,
      label: axisLabel(xKey, key),
      value,
      band:
        low !== null && low !== undefined && high !== null && high !== undefined
          ? { low: Number(low), high: Number(high) }
          : undefined,
      share: total === 0 ? 0 : value / total,
      partial:
        index === shown.length - 1 &&
        chronological &&
        input.untilMode === "today",
      segments: slots
        .map((slot) => ({
          slot,
          value: cross.get(JSON.stringify([key, slot])) ?? 0,
        }))
        .filter((segment) => segment.value > 0),
    };
  });

  return {
    measure,
    banded: !!gauge && shape === "line",
    shape,
    available,
    xKey,
    breakdown,
    timeKey,
    chronological,
    collapsed: analyticsCollapsedKeys(input.groupBy, xKey, shape, breakdown),
    slots,
    points,
    max,
    total,
    seriesLength: series.length,
    heat: shape === "heat" ? analyticsHeatRows(input.rows, measure) : null,
  };
};

/**
 * The min, max and last keys of the gauge `key` belongs to, when its min and
 * max are both among `measures`; `last` only when it is selected too.
 */
export const analyticsGaugeKeys = (
  key: string,
  measures: string[],
  folds: Record<string, string>,
): { min: string; max: string; last?: string } | null => {
  const fold = folds[key];
  if (!fold || fold === "sum" || !key.endsWith(`_${fold}`)) return null;
  const base = key.slice(0, -fold.length - 1);
  const min = `${base}_min`;
  const max = `${base}_max`;
  const last = `${base}_last`;
  if (!measures.includes(min) || !measures.includes(max)) return null;
  return { min, max, last: measures.includes(last) ? last : undefined };
};

/**
 * The band between each point's min and max, as one closed path in the same
 * 0-100 viewBox as {@link analyticsLinePath}: along the highs, back along the
 * lows. Points without a band are skipped.
 */
export const analyticsBandPath = (
  points: AnalyticsChartPoint[],
  max: number,
): string => {
  const x = (index: number) =>
    points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
  const y = (value: number) => 100 - (value / max) * 96;
  const banded = points
    .map((point, index) => ({ point, index }))
    .filter((entry) => entry.point.band);
  if (banded.length === 0) return "";
  const top = banded.map(
    ({ point, index }) =>
      `${x(index).toFixed(2)},${y(point.band?.high ?? 0).toFixed(2)}`,
  );
  const bottom = banded
    .toReversed()
    .map(
      ({ point, index }) =>
        `${x(index).toFixed(2)},${y(point.band?.low ?? 0).toFixed(2)}`,
    );
  return `M ${[...top, ...bottom].join(" L ")} Z`;
};

/**
 * The polyline over the points, in a 0-100 viewBox so the SVG can stretch.
 */
export const analyticsLinePath = (
  points: AnalyticsChartPoint[],
  max: number,
): { line: string; area: string } => {
  if (points.length === 0) return { line: "", area: "" };
  const coords = points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 100 - (point.value / max) * 96;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M ${coords.join(" L ")}`;
  return { line, area: `${line} L 100,100 L 0,100 Z` };
};

/**
 * Stroke-dash arcs for the donut, walked in order so each starts where the
 * last one ended.
 */
export const analyticsDonutArcs = (
  points: AnalyticsChartPoint[],
): Array<{ key: string; dash: string; offset: string; index: number }> => {
  const circumference = 99.9;
  const total = Math.max(
    1,
    points.reduce((sum, point) => sum + point.value, 0),
  );
  let walked = 0;
  return points.map((point, index) => {
    const length = (point.value / total) * circumference;
    const arc = {
      key: point.key,
      dash: `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`,
      offset: (-walked).toFixed(2),
      index,
    };
    walked += length;
    return arc;
  });
};

/**
 * Thin the axis labels to at most eight, always keeping the last one, and
 * drop any kept tick that would collide with it.
 *
 * Absolutely placed by percentage rather than one label per slot: at ninety
 * bars a slot is about ten pixels and no date could ever fit in one.
 */
export const analyticsTicks = (
  points: AnalyticsChartPoint[],
): Array<{ key: string; label: string; position: number; last: boolean }> => {
  const wanted = Math.min(points.length, 8);
  const every = Math.max(1, Math.round(points.length / wanted));
  const lastIndex = points.length - 1;
  return points
    .map((point, index) => ({ point, index }))
    .filter(
      ({ index }) =>
        index === lastIndex ||
        (index % every === 0 && lastIndex - index >= every / 2),
    )
    .map(({ point, index }) => ({
      key: point.key,
      label: point.label,
      position: points.length <= 1 ? 0 : (index / (points.length - 1)) * 100,
      last: index === lastIndex,
    }));
};
