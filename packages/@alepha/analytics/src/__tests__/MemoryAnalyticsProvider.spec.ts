import { z } from "alepha";
import { describe, expect, it } from "vitest";
import { MemoryAnalyticsProvider } from "../providers/MemoryAnalyticsProvider.ts";

const dataset = {
  name: "page_views",
  index: "app",
  dimensions: z.object({
    app: z.string(),
    path: z.string(),
    country: z.string(),
  }),
  measures: z.object({ count: z.number() }),
};

describe("MemoryAnalyticsProvider", () => {
  it("sums a measure over the window", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 2 },
      { hour: "2026-08-09T11", app: "a", path: "/x", country: "FR", count: 3 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      select: { count: "sum" },
    });

    expect(result.rows).toEqual([{ count: 5 }]);
    expect(result.estimated).toBe(false);
  });

  it("groups by a dimension and orders descending", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 2 },
      { hour: "2026-08-09T10", app: "a", path: "/y", country: "FR", count: 7 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      groupBy: ["path"],
      select: { count: "sum" },
      orderBy: { key: "count", direction: "desc" },
    });

    expect(result.rows).toEqual([
      { path: "/y", count: 7 },
      { path: "/x", count: 2 },
    ]);
  });

  it("treats an empty inArray as matching nothing, never as unfiltered", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 2 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      where: { app: { inArray: [] } },
      select: { count: "sum" },
    });

    expect(result.rows).toEqual([]);
  });

  it("excludes rows before the window", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-01T10", app: "a", path: "/x", country: "FR", count: 9 },
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 1 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      select: { count: "sum" },
    });

    expect(result.rows).toEqual([{ count: 1 }]);
  });

  it("counts rows for the count aggregate, not the sum of the measure", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 5 },
      { hour: "2026-08-09T11", app: "a", path: "/x", country: "FR", count: 7 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      select: { count: "count" },
    });

    expect(result.rows).toEqual([{ count: 2 }]);
  });

  it("returns the smallest measure value for the min aggregate", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 5 },
      { hour: "2026-08-09T11", app: "a", path: "/x", country: "FR", count: 2 },
      { hour: "2026-08-09T12", app: "a", path: "/x", country: "FR", count: 9 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      select: { count: "min" },
    });

    expect(result.rows).toEqual([{ count: 2 }]);
  });

  it("returns the largest measure value for the max aggregate", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 5 },
      { hour: "2026-08-09T11", app: "a", path: "/x", country: "FR", count: 2 },
      { hour: "2026-08-09T12", app: "a", path: "/x", country: "FR", count: 9 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      select: { count: "max" },
    });

    expect(result.rows).toEqual([{ count: 9 }]);
  });

  it("groups by the day pseudo-dimension", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 2 },
      { hour: "2026-08-09T23", app: "a", path: "/x", country: "FR", count: 3 },
      { hour: "2026-08-10T01", app: "a", path: "/x", country: "FR", count: 4 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      groupBy: ["day"],
      select: { count: "sum" },
      orderBy: { key: "day", direction: "asc" },
    });

    expect(result.rows).toEqual([
      { day: "2026-08-09", count: 5 },
      { day: "2026-08-10", count: 4 },
    ]);
  });

  it("folds hour buckets to day buckets on rollup, without changing sums", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-01T10", app: "a", path: "/x", country: "FR", count: 2 },
      { hour: "2026-08-01T11", app: "a", path: "/x", country: "FR", count: 3 },
    ]);

    await provider.rollup(dataset, "2026-08-02");

    const total = await provider.query(dataset, {
      since: "2026-08-01",
      select: { count: "sum" },
    });
    expect(total.rows).toEqual([{ count: 5 }]);

    const byHour = await provider.query(dataset, {
      since: "2026-08-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    expect(byHour.rows).toEqual([{ hour: "2026-08-01", count: 5 }]);
  });

  it("is idempotent across repeated rollups", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-01T10", app: "a", path: "/x", country: "FR", count: 2 },
    ]);

    await provider.rollup(dataset, "2026-08-02");
    await provider.rollup(dataset, "2026-08-02");
    await provider.rollup(dataset, "2026-08-02");

    const result = await provider.query(dataset, {
      since: "2026-08-01",
      select: { count: "sum" },
    });
    expect(result.rows).toEqual([{ count: 2 }]);
  });
});
