import type { AdminDatasetDescriptor } from "alepha/api/analytics";
import { describe, expect, it } from "vitest";

import {
  analyticsActiveMeasures,
  analyticsAdvancedDirty,
  analyticsDatasetSummary,
  analyticsDefaultOrderBy,
  analyticsEffectiveGroupBy,
  analyticsFilterLabel,
  analyticsGrainLock,
  analyticsInstantWindow,
  analyticsKeyLabel,
  analyticsMeasures,
  analyticsRequestBody,
  analyticsSelect,
  analyticsToday,
  analyticsWhere,
  analyticsWindow,
} from "./analyticsModel.ts";
import type { AnalyticsQueryState } from "./analyticsTypes.ts";

const views: AdminDatasetDescriptor = {
  name: "sigil_views",
  index: "sigilId",
  dimensions: {
    properties: { sigilId: {}, path: {}, country: {} },
  } as never,
  measures: { properties: { count: {}, engaged: {} } } as never,
  folds: { count: ["sum"], engaged: ["sum"] },
  resolution: "1h",
  retention: [
    { resolution: "1h", keep: "30d" },
    { resolution: "1d", keep: "400d" },
  ],
};

const telemetry: AdminDatasetDescriptor = {
  name: "device_metrics",
  index: "deviceId",
  dimensions: { properties: { deviceId: {} } } as never,
  measures: { properties: { validations: {}, temperature: {} } } as never,
  folds: { validations: ["sum"], temperature: ["min", "max", "last"] },
  resolution: "1m",
  retention: [
    { resolution: "1m", keep: "48h" },
    { resolution: "1h", keep: "30d" },
    { resolution: "1d", keep: "400d" },
  ],
};

const state = (
  patch: Partial<AnalyticsQueryState> = {},
): AnalyticsQueryState => ({
  dataset: "sigil_views",
  days: 30,
  instant: null,
  untilMode: "yesterday",
  compare: "previous",
  groupBy: ["day"],
  filters: [],
  limit: 200,
  measures: null,
  orderBy: null,
  ...patch,
});

// 2026-08-21T09:30Z. The clock is passed in rather than read, so every case
// below is a statement about the arithmetic and not about the day it ran.
const NOW = Date.UTC(2026, 7, 21, 9, 30);

describe("analyticsWindow", () => {
  it("ends on the last complete UTC day by default", () => {
    // 30 days ending on the 20th, inclusive of both ends.
    expect(analyticsWindow(analyticsToday(NOW), state())).toEqual({
      from: "2026-07-22",
      to: "2026-08-20",
    });
  });

  it("includes the partial day when until is today", () => {
    expect(
      analyticsWindow(analyticsToday(NOW), state({ untilMode: "today" })),
    ).toEqual({ from: "2026-07-23", to: "2026-08-21" });
  });

  it("steps the baseline back by a whole window, with no gap", () => {
    // The window under study starts 2026-07-22, so its baseline has to end
    // the day before: a gap would silently drop a day out of the comparison.
    expect(analyticsWindow(analyticsToday(NOW), state(), 1)).toEqual({
      from: "2026-06-22",
      to: "2026-07-21",
    });
  });

  it("steps the baseline back a year when comparing to last year", () => {
    expect(
      analyticsWindow(analyticsToday(NOW), state({ compare: "lastYear" }), 1),
    ).toEqual({ from: "2025-07-22", to: "2025-08-20" });
  });

  it("keeps the window the length it was asked for", () => {
    const window = analyticsWindow(analyticsToday(NOW), state({ days: 7 }));
    const span =
      (Date.parse(`${window.to}T00:00:00Z`) -
        Date.parse(`${window.from}T00:00:00Z`)) /
      86_400_000;
    expect(span).toBe(6);
  });
});

describe("the time-grain interlock", () => {
  const days = (count: number) =>
    analyticsWindow(analyticsToday(NOW), state({ days: count }));

  it("allows hour while the hour tier still holds the whole range", () => {
    expect(analyticsGrainLock(views, "hour", days(14), NOW)).toBeNull();
  });

  it("locks hour over 30 days on points, though the hour tier still holds it", () => {
    // 720 hours: past the 500 points a chart can show.
    expect(analyticsGrainLock(views, "hour", days(30), NOW)).toBe("points");
  });

  it("locks hour once the range reaches the day tier", () => {
    expect(analyticsGrainLock(views, "hour", days(90), NOW)).toBe("retention");
  });

  it("never locks on retention a dataset that keeps its finest tier forever", () => {
    // No window on the finest tier means nothing is ever folded, so every day
    // of it is still hour-precise.
    const raw = {
      ...views,
      retention: [{ resolution: "1h" }, { resolution: "1d" }],
    };
    expect(analyticsGrainLock(raw, "hour", days(14), NOW)).toBeNull();
  });

  it("locks a grain that would draw more than the chart can show", () => {
    // 90 days of hours is 2160 points.
    const raw = {
      ...views,
      retention: [{ resolution: "1h" }, { resolution: "1d" }],
    };
    expect(analyticsGrainLock(raw, "hour", days(90), NOW)).toBe("points");
  });

  it("offers minute on a sub-hour dataset only while the minute tier holds the range", () => {
    const last = (minutes: number) =>
      analyticsInstantWindow(NOW, { kind: "relative", minutes }, "previous");
    expect(analyticsGrainLock(telemetry, "minute", last(15), NOW)).toBeNull();
    // 24h of minutes is 1440 points.
    expect(analyticsGrainLock(telemetry, "minute", last(1440), NOW)).toBe(
      "points",
    );
    expect(analyticsGrainLock(telemetry, "hour", last(1440), NOW)).toBeNull();
  });

  it("replaces a locked grain by the finest one the window allows", () => {
    const window = analyticsInstantWindow(
      NOW,
      { kind: "relative", minutes: 360 },
      "previous",
    );
    expect(
      analyticsEffectiveGroupBy(
        telemetry,
        { groupBy: ["day", "deviceId"] },
        window,
        NOW,
      ),
    ).toEqual(["day", "deviceId"]);
    expect(
      analyticsEffectiveGroupBy(
        views,
        { groupBy: ["hour", "path"] },
        days(90),
        NOW,
      ),
    ).toEqual(["day", "path"]);
  });
});

describe("instant windows", () => {
  it("sends a relative range as from/to instants with an offset", () => {
    const window = analyticsInstantWindow(
      NOW,
      { kind: "relative", minutes: 15 },
      "previous",
    );
    const body = analyticsRequestBody(
      telemetry,
      state({ instant: { kind: "relative", minutes: 15 } }),
      window,
      NOW,
    );
    expect(body.since).toBeUndefined();
    expect(body.from).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(
      Date.parse(body.to as string) - Date.parse(body.from as string),
    ).toBe(15 * 60_000);
  });

  it("steps the baseline back by the window's own length", () => {
    const current = analyticsInstantWindow(
      NOW,
      { kind: "relative", minutes: 60 },
      "previous",
    );
    const baseline = analyticsInstantWindow(
      NOW,
      { kind: "relative", minutes: 60 },
      "previous",
      1,
    );
    expect(baseline.to).toBe(current.from);
  });
});

describe("fold-aware selection", () => {
  it("offers each fold of a gauge as its own key", () => {
    expect(analyticsMeasures(telemetry)).toEqual([
      "validations",
      "temperature_min",
      "temperature_max",
      "temperature_last",
    ]);
    expect(analyticsKeyLabel(telemetry, "temperature_max")).toBe(
      "max(temperature)",
    );
    expect(analyticsKeyLabel(telemetry, "validations")).toBe(
      "sum(validations)",
    );
  });

  it("asks for a gauge's folds as one array, so a band is one query", () => {
    expect(
      analyticsSelect(telemetry, [
        "validations",
        "temperature_min",
        "temperature_max",
        "temperature_last",
      ]),
    ).toEqual({
      validations: "sum",
      temperature: ["min", "max", "last"],
    });
  });
});

describe("analyticsWhere", () => {
  it("sends one value as equality", () => {
    expect(analyticsWhere([{ dim: "country", values: ["FR"] }])).toEqual({
      country: "FR",
    });
  });

  it("sends several values as inArray", () => {
    expect(analyticsWhere([{ dim: "country", values: ["FR", "US"] }])).toEqual({
      country: { inArray: ["FR", "US"] },
    });
  });

  it("omits the clause entirely rather than sending an empty object", () => {
    expect(analyticsWhere([])).toBeUndefined();
    expect(analyticsWhere([{ dim: "country", values: [] }])).toBeUndefined();
  });
});

describe("analyticsRequestBody", () => {
  it("bounds both ends of the window", () => {
    const window = analyticsWindow(analyticsToday(NOW), state());
    const body = analyticsRequestBody(views, state(), window, NOW);
    expect(body.since).toBe(window.from);
    // `until` is the whole reason a bounded comparison is expressible.
    expect(body.until).toBe(window.to);
  });

  it("selects every declared measure as a sum by default", () => {
    const window = analyticsWindow(analyticsToday(NOW), state());
    expect(analyticsRequestBody(views, state(), window, NOW).select).toEqual({
      count: "sum",
      engaged: "sum",
    });
  });

  it("never sends a group key the panel says is unavailable", () => {
    const patched = state({ days: 90, groupBy: ["day", "hour"] });
    const window = analyticsWindow(analyticsToday(NOW), patched);
    expect(analyticsRequestBody(views, patched, window, NOW).groupBy).toEqual([
      "day",
    ]);
  });

  it("omits groupBy rather than sending an empty list", () => {
    const patched = state({ groupBy: [] });
    const window = analyticsWindow(analyticsToday(NOW), patched);
    expect(
      analyticsRequestBody(views, patched, window, NOW).groupBy,
    ).toBeUndefined();
  });
});

describe("analyticsActiveMeasures", () => {
  it("falls back to every declared measure", () => {
    expect(analyticsActiveMeasures(views, { measures: null })).toEqual([
      "count",
      "engaged",
    ]);
  });

  it("drops names the dataset never declared", () => {
    // A measure left over from another schema must not survive into a query.
    expect(
      analyticsActiveMeasures(views, { measures: ["engaged", "revenue"] }),
    ).toEqual(["engaged"]);
  });

  it("falls back rather than selecting nothing", () => {
    expect(analyticsActiveMeasures(views, { measures: ["revenue"] })).toEqual([
      "count",
      "engaged",
    ]);
  });
});

describe("analyticsDefaultOrderBy", () => {
  it("reads a time grain chronologically", () => {
    expect(analyticsDefaultOrderBy(["day", "path"], "count")).toEqual({
      key: "day",
      direction: "asc",
    });
  });

  it("puts the biggest group first when there is no time grain", () => {
    // A top-N under a limit is only meaningful if the N are the top ones.
    expect(analyticsDefaultOrderBy(["path"], "count")).toEqual({
      key: "count",
      direction: "desc",
    });
  });
});

describe("analyticsAdvancedDirty", () => {
  it("is clean on the defaults", () => {
    expect(analyticsAdvancedDirty(state())).toBe(false);
  });

  it.each([
    ["until", state({ untilMode: "today" as const })],
    ["compare", state({ compare: "off" as const })],
    ["limit", state({ limit: 50 })],
  ])("is dirty when %s is off-default", (_name, patched) => {
    expect(analyticsAdvancedDirty(patched)).toBe(true);
  });
});

describe("labels", () => {
  it("summarises the schema in one line", () => {
    expect(analyticsDatasetSummary(views)).toBe(
      "sigilId · 3 dims · 2 measures · 1h 30d · 1d 400d",
    );
  });

  it("keeps the count and its noun in agreement", () => {
    const single = {
      ...views,
      dimensions: { properties: { sigilId: {} } } as never,
      measures: { properties: { samples: {} } } as never,
    };
    expect(analyticsDatasetSummary(single)).toContain("1 dim · 1 measure ·");
  });

  it("marks a tier kept forever, and says nothing when no tier has a window", () => {
    expect(
      analyticsDatasetSummary({
        ...views,
        retention: [{ resolution: "1h", keep: "14d" }, { resolution: "1d" }],
      }),
    ).toBe("sigilId · 3 dims · 2 measures · 1h 14d · 1d ∞");
    expect(
      analyticsDatasetSummary({
        ...views,
        retention: [{ resolution: "1h" }, { resolution: "1d" }],
      }),
    ).toBe("sigilId · 3 dims · 2 measures");
  });

  it("names a single-value filter but only counts a set", () => {
    expect(analyticsFilterLabel({ dim: "country", values: ["FR"] })).toBe(
      "country = FR",
    );
    expect(
      analyticsFilterLabel({ dim: "country", values: ["FR", "US", "DE"] }),
    ).toBe("country ∈ (3)");
  });
});
