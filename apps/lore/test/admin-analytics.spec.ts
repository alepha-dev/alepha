import { Alepha } from "alepha";
import { AdminAnalyticsService } from "alepha/api/analytics";
import { describe, expect, it } from "vitest";

import { LoreAnalytics } from "../src/api/entities/loreAnalytics.ts";

/**
 * The admin analytics surface over lore's own datasets. Service-level on
 * purpose: HTTP + `$secure` are covered by the e2e smoke
 * (`e2e/admin-analytics.spec.ts`); this asserts the descriptors and the
 * query path against the real `LoreAnalytics` declarations.
 */
describe("Lore admin analytics surface", () => {
  it("lists both sigil datasets with their declared dimensions", async () => {
    const alepha = Alepha.create();
    const analytics = alepha.inject(LoreAnalytics);
    const service = alepha.inject(AdminAnalyticsService);
    await alepha.start();

    const names = service
      .listDatasets()
      .map((d) => d.name)
      .sort();
    expect(names).toEqual(["sigil_views", "sigil_vitals"]);

    const views = service.listDatasets().find((d) => d.name === "sigil_views");
    const dimensions = Object.keys(views?.dimensions.properties ?? {}).sort();
    expect(dimensions).toEqual(
      [
        "campaign",
        "country",
        "device",
        "path",
        "referrer",
        "sigilId",
        "traffic",
      ].sort(),
    );
    expect(Object.keys(views?.measures.properties ?? {}).sort()).toEqual(
      ["count", "engaged", "entries"].sort(),
    );

    // The wire format, pinned. This used to assert `dimensions.at(-1) ===
    // "traffic"`, because slots derived from the sorted list and a dimension
    // added anywhere but the end shifted every slot after it, so the name
    // had to be chosen for where it sorted. `slots` replaced that constraint
    // with a declaration, and this assertion moved with it.
    //
    // The list is the positions production has already written. It is a
    // PREFIX check on purpose: appending a new dimension must not fail this
    // test (that is the whole point of append-only), while inserting,
    // reordering or dropping one must.
    const pinned = analytics.views.dataset.slots.dimensions;
    expect(pinned.slice(0, 7)).toEqual([
      "campaign",
      "country",
      "device",
      "path",
      "referrer",
      "sigilId",
      "traffic",
    ]);
    expect(analytics.views.dataset.slots.measures.slice(0, 3)).toEqual([
      "count",
      "engaged",
      "entries",
    ]);
    expect(analytics.vitals.dataset.slots.dimensions.slice(0, 4)).toEqual([
      "bucket",
      "metric",
      "path",
      "sigilId",
    ]);
  });

  it("answers a recorded view through the admin query path", async () => {
    const alepha = Alepha.create();
    const analytics = alepha.inject(LoreAnalytics);
    const service = alepha.inject(AdminAnalyticsService);
    await alepha.start();

    await analytics.views.record({
      sigilId: "s1",
      path: "/docs",
      country: "FR",
      count: 3,
      hour: "2026-08-09T10",
    });

    const result = await service.queryDataset("sigil_views", {
      since: "2026-08-09",
      groupBy: ["path"],
      select: { count: "sum" },
    });
    expect(result.rows).toEqual([{ path: "/docs", count: 3 }]);
    expect(result.estimated).toBe(false);
  });
});
