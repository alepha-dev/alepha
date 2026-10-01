import { describe, expect, it } from "vitest";

import type { AnalyticsRow } from "./analyticsTypes.ts";
import {
  analyticsAggregate,
  analyticsAvailableShapes,
  analyticsChartModel,
  analyticsCollapsedKeys,
  analyticsHeatRows,
  analyticsTicks,
} from "./chartModel.ts";

const byDayAndCountry: AnalyticsRow[] = [
  { day: "2026-08-19", country: "FR", count: 10 },
  { day: "2026-08-19", country: "US", count: 4 },
  { day: "2026-08-20", country: "FR", count: 6 },
  { day: "2026-08-20", country: "US", count: 9 },
];

const input = (
  patch: Partial<Parameters<typeof analyticsChartModel>[0]> = {},
) =>
  analyticsChartModel({
    rows: byDayAndCountry,
    groupBy: ["day", "country"],
    measures: ["count"],
    measure: null,
    axis: null,
    shape: null,
    untilMode: "yesterday",
    ...patch,
  });

describe("analyticsAggregate", () => {
  it("folds the result onto a narrower set of keys", () => {
    expect(analyticsAggregate(byDayAndCountry, ["day"], ["count"])).toEqual([
      { day: "2026-08-19", count: 14 },
      { day: "2026-08-20", count: 15 },
    ]);
  });

  it("keeps values apart that a joined key would collide", () => {
    // "a" + sep + "b|c" and "a|b" + sep + "c" are one bucket under any single
    // separator character, and every character is a legal dimension value.
    const rows: AnalyticsRow[] = [
      { a: "x", b: "y-z", count: 1 },
      { a: "x-y", b: "z", count: 1 },
    ];
    expect(analyticsAggregate(rows, ["a", "b"], ["count"])).toHaveLength(2);
  });
});

describe("analyticsAvailableShapes", () => {
  it("offers a line only on an ordered axis", () => {
    expect(
      analyticsAvailableShapes({
        groupBy: ["path"],
        chronological: false,
        breakdown: null,
        seriesLength: 20,
      }),
    ).not.toContain("line");
  });

  it("offers a 100% share only when there is something to divide", () => {
    const without = analyticsAvailableShapes({
      groupBy: ["day"],
      chronological: true,
      breakdown: null,
      seriesLength: 30,
    });
    const with_ = analyticsAvailableShapes({
      groupBy: ["day", "country"],
      chronological: true,
      breakdown: "country",
      seriesLength: 30,
    });
    expect(without).not.toContain("share");
    expect(with_).toContain("share");
  });

  it("offers a donut only while the slices stay readable", () => {
    const few = analyticsAvailableShapes({
      groupBy: ["country"],
      chronological: false,
      breakdown: null,
      seriesLength: 5,
    });
    const many = analyticsAvailableShapes({
      groupBy: ["path"],
      chronological: false,
      breakdown: null,
      seriesLength: 40,
    });
    expect(few).toContain("donut");
    expect(many).not.toContain("donut");
  });

  it("leads with the heatmap when both time keys are grouped", () => {
    expect(
      analyticsAvailableShapes({
        groupBy: ["day", "hour"],
        chronological: true,
        breakdown: null,
        seriesLength: 30,
      })[0],
    ).toBe("heat");
  });
});

describe("analyticsChartModel", () => {
  it("puts the time grain on the x-axis and the dimension in the breakdown", () => {
    const model = input();
    expect(model.xKey).toBe("day");
    expect(model.breakdown).toBe("country");
  });

  it("follows an explicit axis choice over the time grain", () => {
    const model = input({ axis: "country" });
    expect(model.xKey).toBe("country");
    expect(model.chronological).toBe(false);
  });

  it("falls back to a supported shape rather than erroring", () => {
    // A line is meaningless once the axis is a dimension, so a saved `line`
    // has to degrade instead of rendering nothing.
    const model = input({ axis: "country", shape: "line" });
    expect(model.available).not.toContain("line");
    expect(model.shape).toBe(model.available[0]);
  });

  it("stacks the breakdown into bars", () => {
    const model = input({ shape: "bars" });
    expect(model.slots).toEqual(["FR", "US"]);
    expect(model.points[0].segments.map((s) => s.value)).toEqual([10, 4]);
  });

  it("sums across the breakdown on a line, and says which key it lost", () => {
    const model = input({ shape: "line" });
    expect(model.points.map((point) => point.value)).toEqual([14, 15]);
    expect(model.points[0].segments).toEqual([]);
    expect(model.collapsed).toEqual(["country"]);
  });

  it("names nothing as collapsed when the shape draws every key", () => {
    expect(input({ shape: "bars" }).collapsed).toEqual([]);
  });

  it("ghosts the newest bucket only when the window runs to today", () => {
    expect(input({ untilMode: "today" }).points.at(-1)?.partial).toBe(true);
    expect(input().points.at(-1)?.partial).toBe(false);
  });

  it("caps a categorical axis and reports the population it came from", () => {
    const rows: AnalyticsRow[] = Array.from({ length: 20 }, (_, index) => ({
      path: `/p${index}`,
      count: index,
    }));
    const model = analyticsChartModel({
      rows,
      groupBy: ["path"],
      measures: ["count"],
      measure: null,
      axis: null,
      shape: null,
      untilMode: "yesterday",
    });
    expect(model.points).toHaveLength(12);
    expect(model.seriesLength).toBe(20);
    // Biggest first: a top-N of an arbitrary slice would be a lie.
    expect(model.points[0].key).toBe("/p19");
  });

  it("never caps a chronological axis", () => {
    const rows: AnalyticsRow[] = Array.from({ length: 120 }, (_, index) => ({
      day: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
      hour: `2026-01-01T${String(index % 24).padStart(2, "0")}`,
      count: 1,
    }));
    const model = analyticsChartModel({
      rows,
      groupBy: ["hour"],
      measures: ["count"],
      measure: null,
      axis: null,
      shape: "bars",
      untilMode: "yesterday",
    });
    expect(model.points).toHaveLength(24);
    expect(model.seriesLength).toBe(24);
  });
});

describe("analyticsCollapsedKeys", () => {
  it("counts both time keys as drawn by a heatmap", () => {
    expect(
      analyticsCollapsedKeys(["day", "hour"], "day", "heat", null),
    ).toEqual([]);
  });
});

describe("analyticsHeatRows", () => {
  it("splits the hour bucket into its own two axes", () => {
    // `hour` is `YYYY-MM-DDTHH`, so the day is its own prefix.
    const rows: AnalyticsRow[] = [
      { hour: "2026-08-19T09", count: 3 },
      { hour: "2026-08-19T09", count: 2 },
      { hour: "2026-08-20T23", count: 8 },
    ];
    const heat = analyticsHeatRows(rows, "count");
    expect(heat.map((row) => row.day)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(heat[0].cells).toHaveLength(24);
    expect(heat[0].cells[9].value).toBe(5);
    expect(heat[1].cells[23].value).toBe(8);
    expect(heat[0].total).toBe(5);
  });

  it("ignores a row with no hour bucket rather than inventing one", () => {
    expect(
      analyticsHeatRows([{ day: "2026-08-19", count: 3 }], "count"),
    ).toHaveLength(0);
  });
});

describe("analyticsTicks", () => {
  it("thins to at most eight labels and always keeps the last", () => {
    const points = Array.from({ length: 90 }, (_, index) => ({
      key: String(index),
      label: String(index),
      value: 1,
      share: 0,
      segments: [],
      partial: false,
    }));
    const ticks = analyticsTicks(points);
    expect(ticks.length).toBeLessThanOrEqual(9);
    expect(ticks.at(-1)?.label).toBe("89");
    expect(ticks.at(-1)?.last).toBe(true);
  });
});
