import { z } from "alepha";
import { describe, expect, it } from "vitest";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";
import { MemoryAnalyticsProvider } from "../providers/MemoryAnalyticsProvider.ts";
import { WaeAnalyticsProvider } from "../providers/WaeAnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import { AnalyticsEngineSql } from "../services/AnalyticsEngineSql.ts";
import { FakeAnalyticsEngine } from "./FakeAnalyticsEngine.ts";

const dataset = {
  name: "wae_views",
  index: "app",
  dimensions: z.object({ app: z.string(), path: z.string() }),
  measures: z.object({ count: z.number() }),
};

/**
 * A `MemoryAnalyticsProvider` that also records what it was called with, so
 * delegation from `WaeAnalyticsProvider` can be asserted directly rather than
 * merely "did not throw". No `vi.spyOn` — service substitution is the
 * established pattern in this codebase.
 */
class RecordingColdProvider extends MemoryAnalyticsProvider {
  public readonly registeredDatasets: string[] = [];
  public readonly rolledUpBefore: string[] = [];
  public readonly prunedBefore: string[] = [];

  public register(target: AnalyticsDataset): void {
    this.registeredDatasets.push(target.name);
    super.register(target);
  }

  public async rollup(target: AnalyticsDataset, before: string): Promise<void> {
    this.rolledUpBefore.push(before);
    await super.rollup(target, before);
  }

  public async prune(target: AnalyticsDataset, before: string): Promise<void> {
    this.prunedBefore.push(before);
    await super.prune(target, before);
  }
}

const build = () => {
  const engine = new FakeAnalyticsEngine();
  const sql = new AnalyticsEngineSql({ accountId: "acct", token: "tok" });
  // Route the real `AnalyticsEngineSql`'s reads through the fake — its own
  // `quote` / `num` / `str` statics stay in play, only the HTTP call is
  // replaced. Missing this wiring was a defect in the plan's own draft: as
  // originally written, `sql.query(...)` would have gone out over a real
  // `fetch`, which `vitest` cannot do.
  sql.query = engine.query;
  const cold = new RecordingColdProvider();
  const provider = new WaeAnalyticsProvider({
    dataset: engine,
    datasetName: "app_analytics",
    sql,
    cold,
  });
  return { engine, provider, cold };
};

describe("WaeAnalyticsProvider", () => {
  it("writes the dataset name into blob1 so datasets can share a binding", async () => {
    const { engine, provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
    ]);

    expect(engine.points[0]?.blobs?.[AnalyticsSlotMap.KIND_SLOT - 1]).toBe(
      "wae_views",
    );
  });

  it("writes the caller's hour into blob2 rather than relying on write time", async () => {
    const { engine, provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T05", app: "a", path: "/x", count: 1 },
    ]);

    expect(engine.points[0]?.blobs?.[AnalyticsSlotMap.HOUR_SLOT - 1]).toBe(
      "2026-08-09T05",
    );
  });

  it("places dimensions in alphabetical slots", async () => {
    const { engine, provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
    ]);

    const map = AnalyticsSlotMap.forDataset(dataset);
    const blobs = engine.points[0]?.blobs ?? [];
    expect(blobs[map.blobSlot("app") - 1]).toBe("a");
    expect(blobs[map.blobSlot("path") - 1]).toBe("/x");
  });

  it("indexes on the declared index dimension", async () => {
    const { engine, provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
    ]);

    expect(engine.points[0]?.indexes).toEqual(["a"]);
  });

  it("corrects every count by _sample_interval and reports estimated", async () => {
    const { provider, engine } = build();
    engine.answer([{ count: "40", _sample_interval: "4" }]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      select: { count: "sum" },
    });

    expect(engine.lastQuery).toMatch(/sum\(double\d+ \* _sample_interval\)/);
    expect(result.estimated).toBe(true);
  });

  it("reports an empty inArray as no rows without issuing a query", async () => {
    const { provider, engine } = build();

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      where: { app: { inArray: [] } },
      select: { count: "sum" },
    });

    expect(result.rows).toEqual([]);
    expect(engine.lastQuery).toBeUndefined();
  });

  it("delegates rollup and prune to the durable cold provider", async () => {
    const { provider, cold } = build();
    await provider.rollup(dataset, "2026-08-02");
    await provider.prune(dataset, "2026-01-01");

    expect(cold.rolledUpBefore).toEqual(["2026-08-02"]);
    expect(cold.prunedBefore).toEqual(["2026-01-01"]);
  });

  it("refuses a hot window longer than Analytics Engine keeps data", () => {
    const { provider } = build();
    expect(() =>
      provider.assertRetention({ ...dataset, retention: { hot: "120d" } }),
    ).toThrow(/Analytics Engine keeps roughly 90 days/);
  });

  it("registers by delegating only to the cold provider, since the hot tier has nothing to declare", () => {
    const { provider, cold } = build();
    expect(() => provider.register(dataset)).not.toThrow();
    expect(cold.registeredDatasets).toEqual(["wae_views"]);
  });

  it("fails fast at registration when the hot window exceeds what Analytics Engine keeps", () => {
    const { provider } = build();
    expect(() =>
      provider.register({ ...dataset, retention: { hot: "120d" } }),
    ).toThrow(/Analytics Engine keeps roughly 90 days/);
  });

  it("groups results by a declared dimension, computed from the SQL it actually generated", async () => {
    const { engine, provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", count: 3 },
      { hour: "2026-08-09T11", app: "a", path: "/y", count: 9 },
      { hour: "2026-08-09T12", app: "a", path: "/x", count: 2 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      groupBy: ["path"],
      select: { count: "sum" },
    });

    const byPath = Object.fromEntries(
      result.rows.map((row) => [row.path, row.count]),
    );
    expect(byPath).toEqual({ "/x": 5, "/y": 9 });
    expect(engine.lastQuery).toContain("GROUP BY blob4");
  });

  it("counts rows via sum(_sample_interval), not the sum of the measure", async () => {
    const { provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", count: 5 },
      { hour: "2026-08-09T11", app: "a", path: "/y", count: 7 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      select: { count: "count" },
    });

    // 2 rows, never 12 — the measure values are chosen so the two readings
    // cannot be confused.
    expect(result.rows).toEqual([{ count: 2 }]);
  });

  it("keeps _sample_interval out of the WHERE clause", async () => {
    const { engine, provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
    ]);

    await provider.query(dataset, {
      since: "2026-08-09",
      where: { app: "a" },
      select: { count: "sum" },
    });

    const whereClause =
      /WHERE([\s\S]*?)(?:GROUP BY|HAVING)/.exec(engine.lastQuery ?? "")?.[1] ??
      "";
    // `_sample_interval` is a property of the *sample*, not of the event —
    // filtering on it would bias the very correction it exists to enable.
    expect(whereClause).not.toContain("_sample_interval");
  });

  it("sorts and limits client-side rather than splicing orderBy into SQL", async () => {
    const { engine, provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/low", count: 1 },
      { hour: "2026-08-09T10", app: "a", path: "/high", count: 5 },
      { hour: "2026-08-09T10", app: "a", path: "/mid", count: 3 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      groupBy: ["path"],
      select: { count: "sum" },
      orderBy: { key: "count", direction: "desc" },
      limit: 2,
    });

    expect(result.rows.map((row) => row.path)).toEqual(["/high", "/mid"]);
    // `orderBy.key` never reaches the SQL text: sorting happens after the
    // fetch, which is also what keeps a caller-chosen key from being spliced
    // into an `ORDER BY` clause as a raw identifier.
    expect(engine.lastQuery).not.toMatch(/ORDER BY/i);
    expect(engine.lastQuery).not.toMatch(/LIMIT/i);
  });

  it("rejects a where filter that is not a declared dimension", async () => {
    const { provider } = build();
    await expect(
      provider.query(dataset, {
        since: "2026-08-09",
        where: { "app; DROP TABLE app_analytics; --": "a" },
        select: { count: "sum" },
      }),
    ).rejects.toThrow(/unknown dimension/);
  });

  it("rejects a select measure that is not a declared measure", async () => {
    const { provider } = build();
    await expect(
      provider.query(dataset, {
        since: "2026-08-09",
        select: { "count; DROP TABLE app_analytics; --": "sum" },
      }),
    ).rejects.toThrow(/unknown measure/);
  });

  it("returns no rows rather than a null-valued row when nothing matches", async () => {
    const { provider } = build();
    await provider.record(dataset, [
      { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
    ]);

    const result = await provider.query(dataset, {
      since: "2026-08-09",
      where: { app: { inArray: ["nonexistent"] } },
      select: { count: "sum" },
    });

    expect(result.rows).toEqual([]);
  });
});
