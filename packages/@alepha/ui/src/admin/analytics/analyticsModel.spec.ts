import type { AdminDatasetDescriptor } from "alepha/api/analytics";
import { describe, expect, it } from "vitest";

import {
  analyticsActiveMeasures,
  analyticsAdvancedDirty,
  analyticsDatasetSummary,
  analyticsDefaultOrderBy,
  analyticsEffectiveGroupBy,
  analyticsFilterLabel,
  analyticsHotDays,
  analyticsHourAllowed,
  analyticsRequestBody,
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
  retention: { hot: "30d", rollup: "day", cold: "400d" },
};

const state = (
  patch: Partial<AnalyticsQueryState> = {},
): AnalyticsQueryState => ({
  dataset: "sigil_views",
  days: 30,
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

describe("the hour interlock", () => {
  it("reads the hot window off the dataset's retention", () => {
    expect(analyticsHotDays(views)).toBe(30);
  });

  it("allows hour inside the hot window", () => {
    expect(analyticsHourAllowed(views, 30)).toBe(true);
  });

  it("locks hour once the range reaches the rolled tier", () => {
    expect(analyticsHourAllowed(views, 90)).toBe(false);
  });

  it("never locks a dataset that declares no hot window", () => {
    // No retention means nothing is ever rolled up, so every day of it is
    // still hour-precise. `null` is not zero.
    const raw = { ...views, retention: undefined };
    expect(analyticsHotDays(raw)).toBeNull();
    expect(analyticsHourAllowed(raw, 90)).toBe(true);
  });

  it("strips hour from the effective groupBy while it is locked", () => {
    expect(
      analyticsEffectiveGroupBy(views, {
        groupBy: ["day", "hour"],
        days: 90,
      }),
    ).toEqual(["day"]);
  });

  it("keeps hour once the range fits again", () => {
    expect(
      analyticsEffectiveGroupBy(views, {
        groupBy: ["day", "hour"],
        days: 14,
      }),
    ).toEqual(["day", "hour"]);
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
    const body = analyticsRequestBody(views, state(), window);
    expect(body.since).toBe(window.from);
    // `until` is the whole reason a bounded comparison is expressible.
    expect(body.until).toBe(window.to);
  });

  it("selects every declared measure as a sum by default", () => {
    const window = analyticsWindow(analyticsToday(NOW), state());
    expect(analyticsRequestBody(views, state(), window).select).toEqual({
      count: "sum",
      engaged: "sum",
    });
  });

  it("never sends a group key the panel says is unavailable", () => {
    const patched = state({ days: 90, groupBy: ["day", "hour"] });
    const window = analyticsWindow(analyticsToday(NOW), patched);
    expect(analyticsRequestBody(views, patched, window).groupBy).toEqual([
      "day",
    ]);
  });

  it("omits groupBy rather than sending an empty list", () => {
    const patched = state({ groupBy: [] });
    const window = analyticsWindow(analyticsToday(NOW), patched);
    expect(
      analyticsRequestBody(views, patched, window).groupBy,
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
      "sigilId · 3 dims · 2 measures · 30d hot · day · 400d",
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

  it("skips retention tiers the dataset left undeclared", () => {
    expect(
      analyticsDatasetSummary({ ...views, retention: { hot: "14d" } }),
    ).toBe("sigilId · 3 dims · 2 measures · 14d hot");
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
