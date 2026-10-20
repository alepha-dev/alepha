import { z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  type AnalyticsReading,
  AnalyticsRowFolder,
} from "../planner/AnalyticsRowFolder.ts";
import type { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type { AnalyticsQuery } from "../schemas/analyticsQuerySchema.ts";

export interface AnalyticsConformanceOptions {
  /**
   * The provider only supports the original feature set (hour buckets, sum,
   * two tiers): Analytics Engine. The suite then registers and exercises only
   * the datasets that set allows.
   */
  legacyOnly?: boolean;
}

/**
 * Behaviour every {@link AnalyticsProvider} must exhibit.
 *
 * Deliberately asserts **no large exact sums**. Analytics Engine samples, so a
 * suite pinning "1000 events means 1000" would either fail on the flagship
 * backend or need an exemption that hollows it out. Everything here is either
 * structural (shape, ordering, filtering, idempotency) or small enough to sit
 * below any sampling threshold.
 *
 * The index dimension is deliberately named `appId`, not `app`: a relational
 * provider stores it snake_cased (`app_id`), so a two-word dimension name is
 * what actually exercises name resolution in `where`/`groupBy`/`select` and
 * in `rollup()`'s fold — a single lowercase word like `app` happens to be
 * identical in both cases and would silently pass even with no resolution at
 * all. Two real defects (in `readOne()` and in `rollup()`) shipped past this
 * suite specifically because every dimension here used to be one word.
 */
export const analyticsConformance = (
  name: string,
  factory: (datasets: AnalyticsDataset[]) => Promise<AnalyticsProvider>,
  options: AnalyticsConformanceOptions = {},
) => {
  const dataset: AnalyticsDataset = {
    name: "conformance_views",
    index: "appId",
    dimensions: z.object({
      appId: z.string(),
      path: z.string(),
      bucket: z.number(),
    }),
    measures: z.object({ samples: z.number() }),
    slots: {
      dimensions: ["appId", "path", "bucket"],
      measures: ["samples"],
    },
  };

  // A gauge dataset. `cashLevel` is camelCase so its derived columns
  // (`cash_level_min`, ...) exercise name resolution, as `appId` does above.
  const gauges: AnalyticsDataset = {
    name: "conformance_gauges",
    index: "deviceId",
    dimensions: z.object({ deviceId: z.string() }),
    measures: z.object({ cashLevel: z.number(), validations: z.number() }),
    folds: { cashLevel: ["sum", "min", "max", "last"] },
    slots: { dimensions: ["deviceId"], measures: ["cashLevel", "validations"] },
  };

  const datasets = options.legacyOnly ? [dataset] : [dataset, gauges];
  const boot = () => factory(datasets);

  describe(`AnalyticsProvider conformance: ${name}`, () => {
    it("returns no rows for an empty inArray rather than every row", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        where: { appId: { inArray: [] } },
        select: { samples: "sum" },
      });

      expect(result.rows).toEqual([]);
    });

    it("filters to the named index values", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-09T10",
          appId: "b",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        where: { appId: { inArray: ["a"] } },
        groupBy: ["appId"],
        select: { samples: "sum" },
      });

      expect(result.rows.map((row) => row.appId)).toEqual(["a"]);
    });

    it("orders a leaderboard descending and honours the limit", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/low",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/high",
          bucket: 0,
          samples: 5,
        },
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/mid",
          bucket: 0,
          samples: 3,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        groupBy: ["path"],
        select: { samples: "sum" },
        orderBy: { key: "samples", direction: "desc" },
        limit: 2,
      });

      expect(result.rows.map((row) => row.path)).toEqual(["/high", "/mid"]);
    });

    it("groups by day", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-10T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        groupBy: ["day"],
        select: { samples: "sum" },
        orderBy: { key: "day", direction: "asc" },
      });

      expect(result.rows.map((row) => row.day)).toEqual([
        "2026-08-09",
        "2026-08-10",
      ]);
    });

    it("bounds the window at `until`, inclusive of every hour of that day", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        // Late on the last day of the window: `until` names a DAY, so an
        // implementation comparing it against the `YYYY-MM-DDTHH` bucket
        // without care drops this row and reports the day as empty.
        {
          hour: "2026-08-10T23",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-11T00",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        until: "2026-08-10",
        groupBy: ["day"],
        select: { samples: "sum" },
        orderBy: { key: "day", direction: "asc" },
      });

      expect(result.rows.map((row) => row.day)).toEqual([
        "2026-08-09",
        "2026-08-10",
      ]);
    });

    it("returns nothing when `until` precedes `since`", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        until: "2026-08-08",
        select: { samples: "sum" },
      });

      expect(result.rows).toEqual([]);
    });

    it("keeps a histogram queryable after a rollup, since percentiles need it", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-01T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-01T11",
          appId: "a",
          path: "/x",
          bucket: 2,
          samples: 1,
        },
      ]);

      await provider.rollup(dataset, "2026-08-02");

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        groupBy: ["bucket"],
        select: { samples: "sum" },
        orderBy: { key: "bucket", direction: "asc" },
      });

      expect(result.rows.map((row) => Number(row.bucket))).toEqual([0, 2]);
    });

    it("is idempotent across repeated rollups", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-01T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 4,
        },
      ]);

      await provider.rollup(dataset, "2026-08-02");
      const once = await provider.query(dataset, {
        since: "2026-08-01",
        select: { samples: "sum" },
      });

      await provider.rollup(dataset, "2026-08-02");
      const twice = await provider.query(dataset, {
        since: "2026-08-01",
        select: { samples: "sum" },
      });

      expect(twice.rows).toEqual(once.rows);
    });

    it("sums across the rollup boundary", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-01T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 2,
        },
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 3,
        },
      ]);

      await provider.rollup(dataset, "2026-08-02");

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        select: { samples: "sum" },
      });

      // Small enough to sit below any sampling threshold, so a sampled
      // backend can satisfy it truthfully.
      expect(Number(result.rows[0]?.samples)).toBe(5);
    });

    it("a count declared as a measure (1 per event, summed) survives a rollup — the portable replacement for a 'count' aggregate", async () => {
      // `AnalyticsAggregate` has no `count` — it is stored-row count on every
      // backend (`COUNT(*)` relationally, `+1` per array entry in memory),
      // which is not the same number across backends on identical writes and
      // does not survive a rollup at all (folding rows collapses the very
      // thing being counted). The portable pattern is what this test pins:
      // declare a measure that is `1` per event, and `sum` it — `sum` is
      // mergeable across a rollup boundary and sample-correctable, so a
      // count modelled this way is exactly the same number before and after
      // folding, on every backend.
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-01T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-01T11",
          appId: "a",
          path: "/y",
          bucket: 0,
          samples: 1,
        },
      ]);

      await provider.rollup(dataset, "2026-08-02");

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        select: { samples: "sum" },
      });

      // Two events, each contributing 1 — the row count, reconstructed by
      // summing after the fold rather than by counting rows.
      expect(Number(result.rows[0]?.samples)).toBe(2);
    });

    it("prunes rolled rows older than the cold boundary", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-01T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);

      // Roll first. Pruning only ever runs past the cold boundary, which is
      // always older than the hot one, so in production every row it deletes
      // has already been folded. A prune test on un-rolled rows would pass
      // against an implementation that never looks at the rolled tier at all.
      await provider.rollup(dataset, "2026-08-05");
      await provider.prune(dataset, "2026-08-05");

      const result = await provider.query(dataset, {
        since: "2026-07-01",
        groupBy: ["day"],
        select: { samples: "sum" },
      });

      expect(result.rows.map((row) => row.day)).toEqual(["2026-08-09"]);
    });

    it("reports the oldest bucket of each tier, and nothing for an empty one", async () => {
      const provider = await boot();
      expect(await provider.oldestBucket(dataset, "raw")).toBeUndefined();
      expect(await provider.oldestBucket(dataset, "rolled")).toBeUndefined();

      await provider.record(dataset, [
        {
          hour: "2026-08-01T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-03T05",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-09T23",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);
      expect(await provider.oldestBucket(dataset, "raw")).toBe("2026-08-01T10");

      await provider.rollup(dataset, "2026-08-05");
      expect(await provider.oldestBucket(dataset, "raw")).toBe("2026-08-09T23");
      expect(await provider.oldestBucket(dataset, "rolled")).toBe("2026-08-01");
    });

    it("bounds the window on day edges without dropping the first or last hour", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-08T23",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-09T00",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 2,
        },
        {
          hour: "2026-08-09T23",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 4,
        },
        {
          hour: "2026-08-10T00",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 8,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        until: "2026-08-09",
        select: { samples: "sum" },
      });

      expect(Number(result.rows[0]?.samples)).toBe(6);
    });

    it("keeps estimated and sampleInterval consistent with each other", async () => {
      const provider = await boot();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          appId: "a",
          path: "/x",
          bucket: 0,
          samples: 1,
        },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        select: { samples: "sum" },
      });

      // A real invariant rather than a type check. An exact backend must not
      // claim a sample interval; a sampling one must report the interval it
      // actually applied, and 1 means it did not sample.
      if (result.estimated) {
        expect(result.sampleInterval).toBeGreaterThanOrEqual(1);
      } else {
        expect(result.sampleInterval).toBeUndefined();
      }
    });

    describe.skipIf(options.legacyOnly)("gauge folds", () => {
      const at = (iso: string) => Date.parse(`${iso}:00.000Z`);
      const record = (provider: AnalyticsProvider, rows: AnalyticsReading[]) =>
        provider.record(gauges, AnalyticsRowFolder.fold(gauges, rows));
      const all: AnalyticsQuery["select"] = {
        cashLevel: ["sum", "min", "max", "last"],
        validations: "sum",
      };

      // Recorded out of order and over several calls, so the upsert merge
      // and not only the pre-fold decides the result. The latest reading of
      // the first day carries no cash level and must not become its `last`.
      const seed = async (provider: AnalyticsProvider) => {
        await record(provider, [
          {
            hour: "2026-08-01T11",
            at: at("2026-08-01T11:10"),
            deviceId: "d1",
            cashLevel: 70,
            validations: 1,
          },
        ]);
        await record(provider, [
          {
            hour: "2026-08-01T11",
            at: at("2026-08-01T11:40"),
            deviceId: "d1",
            validations: 1,
          },
        ]);
        await record(provider, [
          {
            hour: "2026-08-01T10",
            at: at("2026-08-01T10:50"),
            deviceId: "d1",
            cashLevel: 30,
            validations: 1,
          },
        ]);
        await record(provider, [
          {
            hour: "2026-08-01T10",
            at: at("2026-08-01T10:05"),
            deviceId: "d1",
            cashLevel: 50,
            validations: 1,
          },
          {
            hour: "2026-08-09T10",
            at: at("2026-08-09T10:00"),
            deviceId: "d1",
            cashLevel: 10,
            validations: 1,
          },
        ]);
      };

      it("keeps totals, extremes and last unchanged across a rollup, with out-of-order and missing readings", async () => {
        const provider = await boot();
        await seed(provider);

        const read = () =>
          provider.query(gauges, {
            since: "2026-08-01",
            groupBy: ["day"],
            select: all,
            orderBy: { key: "day", direction: "asc" },
          });
        const total = () =>
          provider.query(gauges, { since: "2026-08-01", select: all });

        const expectedDays = [
          {
            day: "2026-08-01",
            cashLevel_sum: 150,
            cashLevel_min: 30,
            cashLevel_max: 70,
            cashLevel_last: 70,
            validations: 4,
          },
          {
            day: "2026-08-09",
            cashLevel_sum: 10,
            cashLevel_min: 10,
            cashLevel_max: 10,
            cashLevel_last: 10,
            validations: 1,
          },
        ];
        const expectedTotal = [
          {
            cashLevel_sum: 160,
            cashLevel_min: 10,
            cashLevel_max: 70,
            cashLevel_last: 10,
            validations: 5,
          },
        ];

        expect((await read()).rows).toEqual(expectedDays);
        expect((await total()).rows).toEqual(expectedTotal);

        await provider.rollup(gauges, "2026-08-05");
        expect(await provider.oldestBucket(gauges, "rolled")).toBe(
          "2026-08-01",
        );
        expect((await read()).rows).toEqual(expectedDays);
        expect((await total()).rows).toEqual(expectedTotal);

        await provider.rollup(gauges, "2026-08-05");
        expect((await total()).rows).toEqual(expectedTotal);
      });

      it("keeps the larger value when two readings share an instant, before and after a rollup", async () => {
        const provider = await boot();
        const instant = at("2026-08-01T10:30");
        await record(provider, [
          {
            hour: "2026-08-01T10",
            at: instant,
            deviceId: "d1",
            cashLevel: 9,
            validations: 1,
          },
        ]);
        await record(provider, [
          {
            hour: "2026-08-01T10",
            at: instant,
            deviceId: "d1",
            cashLevel: 5,
            validations: 1,
          },
          {
            hour: "2026-08-01T11",
            at: instant,
            deviceId: "d1",
            cashLevel: 7,
            validations: 1,
          },
        ]);

        const last = async () =>
          (
            await provider.query(gauges, {
              since: "2026-08-01",
              select: { cashLevel: "last" },
            })
          ).rows;

        expect(await last()).toEqual([{ cashLevel: 9 }]);
        await provider.rollup(gauges, "2026-08-02");
        expect(await last()).toEqual([{ cashLevel: 9 }]);
      });

      it("returns null for a gauge over buckets that hold no reading, and sorts it last", async () => {
        const provider = await boot();
        await record(provider, [
          {
            hour: "2026-08-01T10",
            at: at("2026-08-01T10:00"),
            deviceId: "d1",
            cashLevel: 3,
            validations: 1,
          },
          {
            hour: "2026-08-01T10",
            at: at("2026-08-01T10:00"),
            deviceId: "d2",
            validations: 2,
          },
        ]);

        for (const direction of ["asc", "desc"] as const) {
          const result = await provider.query(gauges, {
            since: "2026-08-01",
            groupBy: ["deviceId"],
            select: { cashLevel: ["min", "last"], validations: "sum" },
            orderBy: { key: "cashLevel_min", direction },
          });
          expect(result.rows).toEqual([
            {
              deviceId: "d1",
              cashLevel_min: 3,
              cashLevel_last: 3,
              validations: 1,
            },
            {
              deviceId: "d2",
              cashLevel_min: null,
              cashLevel_last: null,
              validations: 2,
            },
          ]);
        }
      });

      it("refuses a fold the measure does not declare", async () => {
        const provider = await boot();
        await expect(
          provider.query(gauges, {
            since: "2026-08-01",
            select: { validations: "max" },
          }),
        ).rejects.toThrow("declares 'sum' only");
      });
    });
  });
};
