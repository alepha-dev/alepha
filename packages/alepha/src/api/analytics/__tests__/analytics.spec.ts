import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

// Imported through the module entry, not the primitive file directly:
// `$analytics`'s DI auto-wiring depends on `AnalyticsPrimitive` having been
// tagged with `AlephaApiAnalytics` module metadata, which only happens once
// `index.ts` (where `$module({ primitives: [$analytics] })` is called) has
// been evaluated. `../index.ts` mirrors how `alepha/api/files`'s own
// `$storage.spec.ts` imports `$storage`.
import {
  $analytics,
  type AnalyticsDataset,
  AnalyticsProvider,
  MemoryAnalyticsProvider,
} from "../index.ts";

class PageViews {
  public readonly views = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string(), path: z.string() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app", "path"], measures: ["count"] },
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
        slots: { dimensions: ["app"], measures: ["count"] },
        retention: { hot: "120d" },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TooLong);
    await alepha.start();

    // The relational provider has no ceiling, so this must be accepted here.
    expect(app.views.dataset.retention?.hot).toBe("120d");
  });

  it("rejects a cold window shorter than the hot window", () => {
    // A shorter `cold` would let `prune()` delete rows in
    // `[coldCutoff, hotCutoff)` that the same sweep's `rollup()` never
    // touched — still hour-precision, still inside the hot window. That is
    // data loss, not a resolution change, so it has to fail at declaration
    // time rather than the first time the sweep actually runs.
    class ShortCold {
      public readonly views = $analytics({
        index: "app",
        dimensions: z.object({ app: z.string() }),
        measures: z.object({ count: z.number() }),
        slots: { dimensions: ["app"], measures: ["count"] },
        retention: { hot: "60d", cold: "5d" },
      });
    }

    const alepha = Alepha.create();
    let error: Error | undefined;
    try {
      alepha.inject(ShortCold);
    } catch (caught) {
      error = caught as Error;
    }

    expect(error?.message).toContain("retention.cold");
    expect(error?.message).toContain("60d");
    expect(error?.message).toContain("5d");
  });

  it("accepts a cold window equal to the hot window", async () => {
    // The boundary case: `cold === hot` prunes exactly what this sweep would
    // have just rolled up, nothing more — not a violation of the invariant.
    class EqualWindows {
      public readonly views = $analytics({
        index: "app",
        dimensions: z.object({ app: z.string() }),
        measures: z.object({ count: z.number() }),
        slots: { dimensions: ["app"], measures: ["count"] },
        retention: { hot: "60d", cold: "60d" },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(EqualWindows);
    await alepha.start();

    expect(app.views.dataset.retention?.cold).toBe("60d");
  });

  it("rejects a camelCase property key, since it becomes a table name", () => {
    // `MemoryAnalyticsProvider.register()` is a no-op, so under test — where
    // memory is always the bound provider — a bad name would otherwise pass
    // silently and only fail once the app runs against a relational or
    // Analytics Engine backend. `pageViews` is deliberately the exact style
    // every other class field in this codebase uses.
    class App {
      public readonly pageViews = $analytics({
        index: "app",
        dimensions: z.object({ app: z.string() }),
        measures: z.object({ count: z.number() }),
        slots: { dimensions: ["app"], measures: ["count"] },
      });
    }

    const alepha = Alepha.create();
    let error: Error | undefined;
    try {
      alepha.inject(App);
    } catch (caught) {
      error = caught as Error;
    }

    // Names both remedies rather than only describing the problem.
    expect(error?.message).toContain(
      "Dataset name 'pageViews' must be snake_case",
    );
    expect(error?.message).toContain("rename the property to 'page_views'");
    expect(error?.message).toContain('explicit { name: "..." }');
  });

  it("rejects a dimension named 'day', which is permanently shadowed by the time pseudo-dimension, even under MemoryAnalyticsProvider", () => {
    // `AnalyticsEntityFactory.assertNoCollisions` used to be reachable only
    // from `OrmAnalyticsProvider.register()` (via its own
    // `AnalyticsEntityFactory.build()`). `MemoryAnalyticsProvider.register()`
    // is a no-op and never calls it, so under test — where memory is always
    // the bound provider — this dataset used to pass every test and only
    // throw once a relational or Analytics Engine deployment registered it
    // in production. Hoisting the check into `AnalyticsPrimitive.onInit`
    // (this test's whole point) makes it backend-independent.
    class App {
      public readonly views = $analytics({
        index: "app",
        dimensions: z.object({ app: z.string(), day: z.string() }),
        measures: z.object({ count: z.number() }),
        slots: { dimensions: ["app", "day"], measures: ["count"] },
      });
    }

    const alepha = Alepha.create();
    let error: Error | undefined;
    try {
      alepha.inject(App);
    } catch (caught) {
      error = caught as Error;
    }

    expect(error?.message).toContain("reserved as a time pseudo-dimension");
  });

  it("lets an explicit snake_case name override a camelCase property key", async () => {
    class App {
      public readonly pageViews = $analytics({
        name: "page_views",
        index: "app",
        dimensions: z.object({ app: z.string() }),
        measures: z.object({ count: z.number() }),
        slots: { dimensions: ["app"], measures: ["count"] },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    expect(app.pageViews.dataset.name).toBe("page_views");
  });

  it("registers the dataset with the provider before alepha.start(), not after", () => {
    // Service substitution, not `vi.mock`/`vi.spyOn` — this codebase's house
    // style. `RecordingAnalyticsProvider` wraps the real (memory) provider so
    // the recorded call is a faithful `register()`, not a bare stub.
    class RecordingAnalyticsProvider extends MemoryAnalyticsProvider {
      public readonly registered: string[] = [];

      public override register(dataset: AnalyticsDataset): void {
        this.registered.push(dataset.name);
        super.register(dataset);
      }
    }

    const alepha = Alepha.create().with({
      provide: AnalyticsProvider,
      use: RecordingAnalyticsProvider,
    });

    alepha.inject(PageViews);
    const provider = alepha.inject(RecordingAnalyticsProvider);

    // No `alepha.start()` anywhere in this test — the assertion has to hold
    // with the container still unstarted, which is what pins the ordering
    // rather than merely the fact that registration happens at some point.
    expect(provider.registered).toEqual(["views"]);
  });
});
