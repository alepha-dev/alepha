import { Alepha, z } from "alepha";
import {
  DatabaseProvider,
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

import { OrmAnalyticsProvider } from "../providers/OrmAnalyticsProvider.ts";
import { analyticsConformance } from "./analyticsConformance.ts";

const dataset = {
  name: "orm_views",
  index: "app",
  dimensions: z.object({ app: z.string(), path: z.string() }),
  measures: z.object({ count: z.number() }),
  slots: { dimensions: ["app", "path"], measures: ["count"] },
};

describe("OrmAnalyticsProvider", () => {
  it("adds to an existing bucket rather than inserting a duplicate row", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(dataset);
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
    provider.register(dataset);
    await alepha.start();

    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", app: "a", path: "/x", count: 4 },
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 6 },
      ]);
      await provider.rollup(dataset, 0, "2026-08-05");

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([{ count: 10 }]);
    } finally {
      await alepha.stop();
    }
  });

  it("registers a dataset's tables idempotently, and a second call is a no-op", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(dataset);
    provider.register(dataset);
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

  it("throws a clear error when a dataset was never registered before use", async () => {
    // This provider never invents a table at request time — see the class
    // doc. A dataset reaching `record()`/`query()` without a prior
    // `register()` call is an app bug: it declared a dataset it never
    // registered, and the failure needs to be loud and specific rather than
    // a bare "relation does not exist" from Postgres.
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    await alepha.start();

    try {
      await expect(
        provider.record(dataset, [
          { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
        ]),
      ).rejects.toThrow(/'orm_views' was never registered/);
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
    provider.register(dataset);
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

  it("filters and groups on a multi-word dimension name, which the model builder stores snake_cased", async () => {
    // Regression guard: `readOne` used to splice the dataset's JS field name
    // (`sigilId`) straight into `sql.raw` for `where` and `groupBy`, instead
    // of resolving it through the table the way `accumulateSet` already did
    // for upserts. That works by accident for a single-word dimension like
    // `app` (its snake_case column name is identical), and throws `no such
    // column` for any multi-word one — exactly what every Lore Insights read
    // hit via `{ sigilId: { inArray: [...] } }`, on every single query,
    // because a sigil-scoped analytics dataset has no other way to filter by
    // app.
    const multiWordDataset = {
      name: "orm_multiword_views",
      index: "appId",
      dimensions: z.object({ appId: z.string(), path: z.string() }),
      measures: z.object({ count: z.number() }),
      slots: { dimensions: ["appId", "path"], measures: ["count"] },
    };

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(multiWordDataset);
    await alepha.start();

    try {
      await provider.record(multiWordDataset, [
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 2 },
        { hour: "2026-08-09T10", appId: "b", path: "/x", count: 5 },
      ]);

      const filtered = await provider.query(multiWordDataset, {
        since: "2026-08-09",
        where: { appId: { inArray: ["a"] } },
        select: { count: "sum" },
      });
      expect(filtered.rows).toEqual([{ count: 2 }]);

      const grouped = await provider.query(multiWordDataset, {
        since: "2026-08-09",
        groupBy: ["appId"],
        select: { count: "sum" },
        orderBy: { key: "appId", direction: "asc" },
      });
      expect(grouped.rows).toEqual([
        { appId: "a", count: 2 },
        { appId: "b", count: 5 },
      ]);
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
    provider.register(dataset);
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

  it("registers the prune-floor table from register() alone, so the schema does not depend on the runtime", async () => {
    // ⚠️ Regression guard for a production outage (2026-08-11). This test
    // used to assert the exact opposite: that `register(dataset)` alone must
    // NOT bring `analytics_prune_floors` into existence, so a plain
    // relational deployment would not carry a table it can never use. Only
    // `WaeAnalyticsProvider.register()` called `registerPruneFloors()`.
    //
    // That made the set of tables an app declares a function of the runtime
    // it booted under — and migrations are generated under one runtime and
    // applied under another. `alepha db migrations create` runs on Node,
    // where `OrmAnalyticsProvider` is the selected provider, so the floor
    // table never entered the snapshot and never got a migration. Production
    // runs workerd, where `WaeAnalyticsProvider` IS selected, and its
    // `query()` reads the floor before every single read — against a table
    // D1 had never been told to create. Every Insights read 500'd.
    //
    // The saving in the relational case was two columns. The cost was an
    // outage no test, no typecheck and no `check:migrations` could see,
    // because every one of them runs on the runtime where the table is not
    // declared. Schema must not vary by runtime; the floor table is now
    // unconditional.
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(dataset);
    await alepha.start();

    try {
      expect(await provider.pruneFloor(dataset)).toBeUndefined();

      await provider.recordPruneFloor(dataset, "2026-08-05");
      expect(await provider.pruneFloor(dataset)).toBe("2026-08-05");
    } finally {
      await alepha.stop();
    }
  });

  it("recordPruneFloor is monotonic: a later boundary moves it, an earlier one does not", async () => {
    // The mechanism `WaeAnalyticsProvider.prune()` relies on to honour
    // `AnalyticsProvider.prune`'s "on whichever tier it lives" contract when
    // the hot tier (Analytics Engine) has no delete API of its own. Tested
    // here directly, independent of any WAE plumbing, since this provider
    // owns the storage and the monotonic guarantee — `registerPruneFloors()`
    // called explicitly, the same way only `WaeAnalyticsProvider.register()`
    // ever calls it in real use.
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(dataset);
    provider.registerPruneFloors();
    await alepha.start();

    try {
      expect(await provider.pruneFloor(dataset)).toBeUndefined();

      await provider.recordPruneFloor(dataset, "2026-08-05");
      expect(await provider.pruneFloor(dataset)).toBe("2026-08-05");

      await provider.recordPruneFloor(dataset, "2026-08-09");
      expect(await provider.pruneFloor(dataset)).toBe("2026-08-09");

      // Earlier than what is already recorded — must not regress, or a
      // caller could resurrect a range that was already correctly hidden.
      await provider.recordPruneFloor(dataset, "2026-08-02");
      expect(await provider.pruneFloor(dataset)).toBe("2026-08-09");
    } finally {
      await alepha.stop();
    }
  });

  it("keeps a separate prune floor per dataset", async () => {
    const otherDataset = {
      name: "orm_other_views",
      index: "app",
      dimensions: z.object({ app: z.string() }),
      measures: z.object({ count: z.number() }),
      slots: { dimensions: ["app"], measures: ["count"] },
    };

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(dataset);
    provider.register(otherDataset);
    provider.registerPruneFloors();
    await alepha.start();

    try {
      await provider.recordPruneFloor(dataset, "2026-08-05");

      expect(await provider.pruneFloor(dataset)).toBe("2026-08-05");
      expect(await provider.pruneFloor(otherDataset)).toBeUndefined();
    } finally {
      await alepha.stop();
    }
  });

  it("registerPruneFloors is idempotent", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(dataset);
    provider.registerPruneFloors();
    provider.registerPruneFloors();
    await alepha.start();

    try {
      await expect(
        provider.recordPruneFloor(dataset, "2026-08-05"),
      ).resolves.toBeUndefined();
      expect(await provider.pruneFloor(dataset)).toBe("2026-08-05");
    } finally {
      await alepha.stop();
    }
  });
});

describe.each([
  {
    dialect: "postgres",
    boot: () => Alepha.create().with(AlephaOrmPostgres),
  },
  {
    dialect: "sqlite",
    boot: () => {
      const alepha = Alepha.create().with({
        provide: DatabaseProvider,
        use: NodeSqliteProvider,
      });
      alepha.store.mut(nodeSqliteOptions, (old) => ({
        ...old,
        path: "sqlite://:memory:",
      }));
      return alepha;
    },
  },
])("OrmAnalyticsProvider bounded prune ($dialect)", ({ boot }) => {
  // Lore's 00:00 UTC sweep timed out with the prune's DELETE in flight
  // (#Q2938): one statement per tier over every expired row, however many.
  const days = (
    provider: OrmAnalyticsProvider,
    of: typeof dataset,
    key: "hour" | "minute" = "hour",
  ) =>
    provider
      .query(of, {
        since: "2000-01-01",
        groupBy: [key],
        select: { count: "sum" },
        orderBy: { key, direction: "asc" },
      })
      .then((result) => result.rows.map((row) => String(row[key])));

  it("drains a 100-day backlog over three calls, 36 days each, and keeps what is inside the window", async ({
    expect,
  }) => {
    const alepha = boot();
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(dataset);
    await alepha.start();

    try {
      const start = Date.parse("2026-01-01T10:00:00.000Z");
      const backlog = Array.from({ length: 100 }, (_, i) => ({
        hour: new Date(start + i * 86_400_000).toISOString().slice(0, 13),
        app: "a",
        path: "/x",
        count: 1,
      }));
      await provider.record(dataset, [
        ...backlog,
        { hour: "2026-06-01T10", app: "a", path: "/x", count: 1 },
      ]);
      // Every expired row folded into the day tier first, as the sweep does
      // before it prunes; the June row stays raw, past `before`.
      await provider.rollup(dataset, 0, "2026-05-01");
      expect(await days(provider, dataset)).toHaveLength(101);

      const remaining: number[] = [];
      for (let call = 0; call < 4; call++) {
        await provider.prune(dataset, "2026-05-01");
        remaining.push((await days(provider, dataset)).length);
      }

      // 100 expired days, 36 a call, oldest first, beside the June row
      // that is inside the window: 64 expired left, then 28, then none. The
      // fourth call finds nothing older than `before` and deletes nothing.
      expect(remaining).toEqual([65, 29, 1, 1]);
      expect(await days(provider, dataset)).toEqual(["2026-06-01T10"]);
    } finally {
      await alepha.stop();
    }
  });

  it("covers at least two hours a call on a minute tier, so its backlog outruns the clock", async ({
    expect,
  }) => {
    const minutes = {
      ...dataset,
      name: "orm_prune_minutes",
      resolution: "1m" as const,
      retention: [{ resolution: "1m" as const, keep: "1h" }],
    };
    const alepha = boot();
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(minutes);
    await alepha.start();

    try {
      // One reading every 10 minutes for six hours: 36 buckets.
      const start = Date.parse("2026-08-01T00:00:00.000Z");
      await provider.record(
        minutes,
        Array.from({ length: 36 }, (_, i) => ({
          hour: new Date(start + i * 600_000).toISOString().slice(0, 16),
          app: "a",
          path: "/x",
          count: 1,
        })),
      );

      await provider.prune(minutes, "2026-08-01T06:00");
      // 36 one-minute buckets would be 00:00 to 00:36; the floor of two
      // hours deletes 00:00 to 01:50, twelve readings.
      const left = await days(provider, minutes, "minute");
      expect(left).toHaveLength(24);
      expect(left[0]).toBe("2026-08-01T02:00");

      await provider.prune(minutes, "2026-08-01T06:00");
      await provider.prune(minutes, "2026-08-01T06:00");
      expect(await days(provider, minutes, "minute")).toEqual([]);
    } finally {
      await alepha.stop();
    }
  });
});

analyticsConformance("orm", async (datasets) => {
  const alepha = Alepha.create().with(AlephaOrmPostgres);
  const provider = alepha.inject(OrmAnalyticsProvider);
  for (const dataset of datasets) provider.register(dataset);
  await alepha.start();
  return provider;
});

analyticsConformance("orm (sqlite)", async (datasets) => {
  const alepha = Alepha.create().with({
    provide: DatabaseProvider,
    use: NodeSqliteProvider,
  });
  alepha.store.mut(nodeSqliteOptions, (old) => ({
    ...old,
    path: "sqlite://:memory:",
  }));
  const provider = alepha.inject(OrmAnalyticsProvider);
  for (const dataset of datasets) provider.register(dataset);
  await alepha.start();
  return provider;
});
