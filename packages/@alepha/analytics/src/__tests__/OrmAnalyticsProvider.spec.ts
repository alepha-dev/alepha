import { Alepha, z } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";
import { OrmAnalyticsProvider } from "../providers/OrmAnalyticsProvider.ts";
import { analyticsConformance } from "./analyticsConformance.ts";

const dataset = {
  name: "orm_views",
  index: "app",
  dimensions: z.object({ app: z.string(), path: z.string() }),
  measures: z.object({ count: z.number() }),
};

describe("OrmAnalyticsProvider", () => {
  it("adds to an existing bucket rather than inserting a duplicate row", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    await alepha.start();

    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 2 },
      ]);
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 3 },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([{ count: 5 }]);
      expect(result.estimated).toBe(false);
    } finally {
      await alepha.stop();
    }
  });

  it("reads across the raw and rolled tables in one query", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    await alepha.start();

    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", app: "a", path: "/x", count: 4 },
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 6 },
      ]);
      await provider.rollup(dataset, "2026-08-05");

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([{ count: 10 }]);
    } finally {
      await alepha.stop();
    }
  });

  it("registers a dataset's tables lazily, on first use, after alepha.start()", async () => {
    // Regression guard for the timing constraint called out in the brief: a
    // provider registered via `alepha.inject()` has no way to know which
    // datasets it will ever see, so registration can only happen when a
    // dataset is first touched — which, in every real caller (and in this
    // very test), is after `alepha.start()` has already run `migrate()`
    // once. If the provider only registered the entity without re-syncing,
    // this insert would fail with "relation ... does not exist".
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    await alepha.start();

    try {
      await expect(
        provider.record(dataset, [
          { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
        ]),
      ).resolves.toBeUndefined();
    } finally {
      await alepha.stop();
    }
  });

  it("rejects a where filter that is not a declared dimension", async () => {
    // `query.where`'s keys reach SQL as raw identifiers. An API surface that
    // forwards request-controlled keys into `where` without checking them
    // against the dataset's declared dimensions would otherwise let an
    // attacker splice arbitrary SQL text in as a column reference.
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    await alepha.start();

    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
      ]);

      await expect(
        provider.query(dataset, {
          since: "2026-08-09",
          where: { "app; DROP TABLE analytics_orm_views_raw; --": "a" },
          select: { count: "sum" },
        }),
      ).rejects.toThrow(/not a declared dimension/);
    } finally {
      await alepha.stop();
    }
  });

  it("returns no rows rather than a null-valued row when nothing matches", async () => {
    // Without a `GROUP BY`, `SUM(...)` over zero matching rows still
    // returns exactly one row with a NULL total in plain SQL — but the
    // interface contract (pinned by `MemoryAnalyticsProvider`) is that an
    // empty match stays an empty result, so "no data" and "measured zero"
    // remain distinguishable.
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    await alepha.start();

    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        where: { app: { inArray: ["nonexistent"] } },
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([]);
    } finally {
      await alepha.stop();
    }
  });
});

analyticsConformance("orm", async () => {
  const alepha = Alepha.create().with(AlephaOrmPostgres);
  const provider = alepha.inject(OrmAnalyticsProvider);
  await alepha.start();
  return provider;
});
