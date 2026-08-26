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
    alepha.inject(LoreAnalytics);
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

    // `traffic` sorts LAST, and that is load-bearing rather than incidental.
    // `AnalyticsSlotMap` derives Analytics Engine slots from this sorted list,
    // so a dimension added anywhere but the end shifts every slot after it and
    // silently misreads every row already stored. Adding `referrer` did
    // exactly that once. A rename that moves this name earlier in the sort is
    // the same mistake wearing different clothes, so it fails here first.
    expect(dimensions.at(-1)).toBe("traffic");
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
