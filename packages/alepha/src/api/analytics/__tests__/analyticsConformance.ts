import { z } from "alepha";
import { describe, expect, it } from "vitest";
import type { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";

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
  factory: () => Promise<AnalyticsProvider>,
) => {
  const dataset = {
    name: "conformance_views",
    index: "appId",
    dimensions: z.object({
      appId: z.string(),
      path: z.string(),
      bucket: z.number(),
    }),
    measures: z.object({ samples: z.number() }),
  };

  describe(`AnalyticsProvider conformance: ${name}`, () => {
    it("returns no rows for an empty inArray rather than every row", async () => {
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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
      const provider = await factory();
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

    it("keeps estimated and sampleInterval consistent with each other", async () => {
      const provider = await factory();
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
  });
};
