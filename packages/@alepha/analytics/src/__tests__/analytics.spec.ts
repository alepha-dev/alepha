import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";
// Imported through the module entry, not the primitive file directly:
// `$analytics`'s DI auto-wiring depends on `AnalyticsPrimitive` having been
// tagged with `AlephaAnalytics` module metadata, which only happens once
// `index.ts` (where `$module({ primitives: [$analytics] })` is called) has
// been evaluated. `../index.ts` mirrors how `alepha/api/files`'s own
// `$storage.spec.ts` imports `$storage`.
import { $analytics } from "../index.ts";

class PageViews {
  public readonly views = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string(), path: z.string() }),
    measures: z.object({ count: z.number() }),
    retention: { hot: "60d", rollup: "day", cold: "400d" },
  });
}

describe("$analytics", () => {
  it("defaults the dataset name to the property key", async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(PageViews);
    await alepha.start();

    expect(app.views.dataset.name).toBe("views");
  });

  it("stamps the hour bucket from DateTimeProvider", async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(PageViews);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    dateTime.pause();
    await app.views.record({ app: "a", path: "/x", count: 1 });

    const result = await app.views.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });

    const expected = new Date(dateTime.nowMillis()).toISOString().slice(0, 13);
    expect(result.rows[0]?.hour).toBe(expected);
  });

  it("lets a caller override the bucket, so a batched envelope keeps its hour", async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(PageViews);
    await alepha.start();

    await app.views.record({
      app: "a",
      path: "/x",
      count: 1,
      hour: "2026-08-09T05",
    });

    const result = await app.views.query({
      since: "2026-08-09",
      groupBy: ["hour"],
      select: { count: "sum" },
    });

    expect(result.rows[0]?.hour).toBe("2026-08-09T05");
  });

  it("rejects a hot window longer than the provider can honour", async () => {
    class TooLong {
      public readonly views = $analytics({
        index: "app",
        dimensions: z.object({ app: z.string() }),
        measures: z.object({ count: z.number() }),
        retention: { hot: "120d" },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TooLong);
    await alepha.start();

    // The relational provider has no ceiling, so this must be accepted here.
    expect(app.views.dataset.retention?.hot).toBe("120d");
  });
});
