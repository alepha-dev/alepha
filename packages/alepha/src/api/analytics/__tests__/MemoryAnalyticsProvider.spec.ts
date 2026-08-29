import { z } from "alepha";
import { describe, expect, it } from "vitest";

import { MemoryAnalyticsProvider } from "../providers/MemoryAnalyticsProvider.ts";
import { analyticsConformance } from "./analyticsConformance.ts";

const dataset = {
  name: "page_views",
  index: "app",
  dimensions: z.object({
    app: z.string(),
    path: z.string(),
    country: z.string(),
  }),
  measures: z.object({ count: z.number() }),
  slots: {
    dimensions: ["app", "path", "country"],
    measures: ["count"],
  },
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

  it("rejects a where filter that is not a declared dimension", async () => {
    // Regression guard: this provider used to validate no query names at
    // all — an undeclared `where`/`groupBy`/`select` key silently produced
    // empty rows or a folded `0` instead of an error. Since Memory is the
    // provider every test runs against, a typo'd dimension used to be green
    // in every test suite and only a 500 in production, against Orm or Wae.
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 1 },
    ]);

    await expect(
      provider.query(dataset, {
        since: "2026-08-09",
        where: { region: "FR" },
        select: { count: "sum" },
      }),
    ).rejects.toThrow(/not a declared dimension/);
  });

  it("rejects a groupBy that is not a declared dimension", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 1 },
    ]);

    await expect(
      provider.query(dataset, {
        since: "2026-08-09",
        groupBy: ["region"],
        select: { count: "sum" },
      }),
    ).rejects.toThrow(/not a declared dimension/);
  });

  it("rejects a select measure that is not a declared measure", async () => {
    const provider = new MemoryAnalyticsProvider();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", country: "FR", count: 1 },
    ]);

    await expect(
      provider.query(dataset, {
        since: "2026-08-09",
        select: { total: "sum" },
      }),
    ).rejects.toThrow(/not a declared measure/);
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
});

analyticsConformance("memory", async () => new MemoryAnalyticsProvider());
