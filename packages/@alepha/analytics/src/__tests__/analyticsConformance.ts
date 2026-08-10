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
 */
export const analyticsConformance = (
  name: string,
  factory: () => Promise<AnalyticsProvider>,
) => {
  const dataset = {
    name: "conformance_views",
    index: "app",
    dimensions: z.object({
      app: z.string(),
      path: z.string(),
      bucket: z.number(),
    }),
    measures: z.object({ samples: z.number() }),
  };

  describe(`AnalyticsProvider conformance: ${name}`, () => {
    it("returns no rows for an empty inArray rather than every row", async () => {
      const provider = await factory();
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", bucket: 0, samples: 1 },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        where: { app: { inArray: [] } },
        select: { samples: "sum" },
      });

      expect(result.rows).toEqual([]);
    });

    it("filters to the named index values", async () => {
      const provider = await factory();
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", bucket: 0, samples: 1 },
        { hour: "2026-08-09T10", app: "b", path: "/x", bucket: 0, samples: 1 },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        where: { app: { inArray: ["a"] } },
        groupBy: ["app"],
        select: { samples: "sum" },
      });

      expect(result.rows.map((row) => row.app)).toEqual(["a"]);
    });

    it("orders a leaderboard descending and honours the limit", async () => {
      const provider = await factory();
      await provider.record(dataset, [
        {
          hour: "2026-08-09T10",
          app: "a",
          path: "/low",
          bucket: 0,
          samples: 1,
        },
        {
          hour: "2026-08-09T10",
          app: "a",
          path: "/high",
          bucket: 0,
          samples: 5,
        },
        {
          hour: "2026-08-09T10",
          app: "a",
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
        { hour: "2026-08-09T10", app: "a", path: "/x", bucket: 0, samples: 1 },
        { hour: "2026-08-10T10", app: "a", path: "/x", bucket: 0, samples: 1 },
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

    it("keeps a histogram queryable after a rollup, since percentiles need it", async () => {
      const provider = await factory();
      await provider.record(dataset, [
        { hour: "2026-08-01T10", app: "a", path: "/x", bucket: 0, samples: 1 },
        { hour: "2026-08-01T11", app: "a", path: "/x", bucket: 2, samples: 1 },
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
        { hour: "2026-08-01T10", app: "a", path: "/x", bucket: 0, samples: 4 },
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
        { hour: "2026-08-01T10", app: "a", path: "/x", bucket: 0, samples: 2 },
        { hour: "2026-08-09T10", app: "a", path: "/x", bucket: 0, samples: 3 },
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

    it("counts rows rather than summing the measure", async () => {
      const provider = await factory();
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", bucket: 0, samples: 5 },
        { hour: "2026-08-09T11", app: "a", path: "/y", bucket: 0, samples: 7 },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        select: { samples: "count" },
      });

      // 2, never 12 — the measure values are chosen so the two readings
      // cannot be confused.
      expect(Number(result.rows[0]?.samples)).toBe(2);
    });

    it("prunes rolled rows older than the cold boundary", async () => {
      const provider = await factory();
      await provider.record(dataset, [
        { hour: "2026-08-01T10", app: "a", path: "/x", bucket: 0, samples: 1 },
        { hour: "2026-08-09T10", app: "a", path: "/x", bucket: 0, samples: 1 },
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
        { hour: "2026-08-09T10", app: "a", path: "/x", bucket: 0, samples: 1 },
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
