import { Alepha, z } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";
import { AlephaAnalytics } from "../index.workerd.ts";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";
import { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";
import { OrmAnalyticsProvider } from "../providers/OrmAnalyticsProvider.ts";
import { WaeAnalyticsProvider } from "../providers/WaeAnalyticsProvider.ts";
import { FakeAnalyticsEngine } from "./FakeAnalyticsEngine.ts";

const dataset = {
  name: "wae_views",
  index: "app",
  dimensions: z.object({ app: z.string(), path: z.string() }),
  measures: z.object({ count: z.number() }),
};

const BINDING_NAME = "ANALYTICS";
const ACCOUNT_ID = "acct";
const API_TOKEN = "tok";

/**
 * Overrides the single HTTP seam `WaeAnalyticsProvider` exposes for its SQL
 * reads — the same shape `CloudflareEmailProvider`'s REST tests use for
 * `httpPost` (see `CloudflareEmailRest.spec.ts`). Reusing
 * `FakeAnalyticsEngine.query` here (rather than duplicating its logic) means
 * `lastQuery` tracking, `answer()`, and the SQL interpreter all keep working
 * unmodified — only the transport changed, from "swap `sql.query`" (possible
 * when the caller held a reference to the `AnalyticsEngineSql` instance) to
 * "override the fetch this provider builds internally" (now that
 * `AnalyticsEngineSql` is constructed inside the provider, from env
 * credentials, and never handed out).
 */
class TestWaeAnalyticsProvider extends WaeAnalyticsProvider {
  public readonly fakeEngine = new FakeAnalyticsEngine();

  protected override async httpFetch(
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const sql = String(init?.body ?? "");
    const rows = await this.fakeEngine.query(sql);
    return new Response(JSON.stringify({ data: rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  /**
   * Exposes the otherwise-`protected` `cold` field for assertions. A getter
   * defined *inside* the subclass, not a change to `WaeAnalyticsProvider`
   * itself — `protected` access is only legal from within the class or a
   * subclass, and test code calling `provider.cold` from outside either is
   * not.
   */
  public get coldProvider(): OrmAnalyticsProvider {
    return this.cold;
  }
}

/**
 * `WaeAnalyticsProvider` is DI-injectable now (see its class doc), which
 * means every test constructs it through a real `Alepha` container rather
 * than `new WaeAnalyticsProvider({ ... })` — and because `cold` is a hard
 * `$inject(OrmAnalyticsProvider)` rather than a substitutable
 * `AnalyticsProvider`, that container needs `AlephaOrmPostgres` wired even
 * for tests that never touch `cold`, the same as every
 * `OrmAnalyticsProvider.spec.ts` test does. Docker/Postgres are already a
 * hard requirement of this repo's test suite for that reason.
 */
const build = async () => {
  const alepha = Alepha.create({
    env: {
      CLOUDFLARE_ANALYTICS_DATASET: BINDING_NAME,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: API_TOKEN,
    },
  }).with(AlephaOrmPostgres);

  const provider = alepha.inject(TestWaeAnalyticsProvider);
  alepha.set("cloudflare.env", { [BINDING_NAME]: provider.fakeEngine });
  await alepha.start();
  return { alepha, provider, engine: provider.fakeEngine };
};

/**
 * Same as {@link build}, except `provider.register(dataset)` runs BEFORE
 * `start()` — required whenever a test needs `cold`'s tables to actually
 * exist (registering after `start()` never gets migrated; see
 * `OrmAnalyticsProvider`'s own eager-registration rule). `build()` cannot be
 * reused for this because it already calls `start()` internally.
 */
const buildRegistered = async () => {
  const alepha = Alepha.create({
    env: {
      CLOUDFLARE_ANALYTICS_DATASET: BINDING_NAME,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: API_TOKEN,
    },
  }).with(AlephaOrmPostgres);

  const provider = alepha.inject(TestWaeAnalyticsProvider);
  alepha.set("cloudflare.env", { [BINDING_NAME]: provider.fakeEngine });
  provider.register(dataset);
  await alepha.start();
  return { alepha, provider, engine: provider.fakeEngine };
};

describe("WaeAnalyticsProvider", () => {
  it("writes the dataset name into blob1 so datasets can share a binding", async () => {
    const { alepha, engine, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
      ]);

      expect(engine.points[0]?.blobs?.[AnalyticsSlotMap.KIND_SLOT - 1]).toBe(
        "wae_views",
      );
    } finally {
      await alepha.stop();
    }
  });

  it("writes the caller's hour into blob2 rather than relying on write time", async () => {
    const { alepha, engine, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T05", app: "a", path: "/x", count: 1 },
      ]);

      expect(engine.points[0]?.blobs?.[AnalyticsSlotMap.HOUR_SLOT - 1]).toBe(
        "2026-08-09T05",
      );
    } finally {
      await alepha.stop();
    }
  });

  it("places dimensions in alphabetical slots", async () => {
    const { alepha, engine, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
      ]);

      const map = AnalyticsSlotMap.forDataset(dataset);
      const blobs = engine.points[0]?.blobs ?? [];
      expect(blobs[map.blobSlot("app") - 1]).toBe("a");
      expect(blobs[map.blobSlot("path") - 1]).toBe("/x");
    } finally {
      await alepha.stop();
    }
  });

  it("indexes on the declared index dimension", async () => {
    const { alepha, engine, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
      ]);

      expect(engine.points[0]?.indexes).toEqual(["a"]);
    } finally {
      await alepha.stop();
    }
  });

  it("refuses to write when no binding was found at start()", async () => {
    const alepha = Alepha.create({
      env: {
        CLOUDFLARE_ANALYTICS_DATASET: BINDING_NAME,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: API_TOKEN,
      },
    }).with(AlephaOrmPostgres);
    const provider = alepha.inject(TestWaeAnalyticsProvider);
    // No `alepha.set("cloudflare.env", ...)` — the binding is never found.
    await alepha.start();
    try {
      await expect(
        provider.record(dataset, [
          { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
        ]),
      ).rejects.toThrow(/binding 'ANALYTICS' was not found/);
    } finally {
      await alepha.stop();
    }
  });

  it("corrects every count by _sample_interval and reports estimated", async () => {
    const { alepha, provider, engine } = await build();
    try {
      engine.answer([{ count: "40", _sample_interval: "4" }]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        select: { count: "sum" },
      });

      expect(engine.lastQuery).toMatch(/sum\(double\d+ \* _sample_interval\)/);
      expect(result.estimated).toBe(true);
    } finally {
      await alepha.stop();
    }
  });

  it("reports an empty inArray as no rows without issuing a query", async () => {
    const { alepha, provider, engine } = await build();
    try {
      const result = await provider.query(dataset, {
        since: "2026-08-09",
        where: { app: { inArray: [] } },
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([]);
      expect(engine.lastQuery).toBeUndefined();
    } finally {
      await alepha.stop();
    }
  });

  it("refuses a hot window longer than Analytics Engine keeps data", async () => {
    const { alepha, provider } = await build();
    try {
      expect(() =>
        provider.assertRetention({ ...dataset, retention: { hot: "120d" } }),
      ).toThrow(/Analytics Engine keeps roughly 90 days/);
    } finally {
      await alepha.stop();
    }
  });

  it("fails fast at registration when the hot window exceeds what Analytics Engine keeps", async () => {
    const { alepha, provider } = await build();
    try {
      expect(() =>
        provider.register({ ...dataset, retention: { hot: "120d" } }),
      ).toThrow(/Analytics Engine keeps roughly 90 days/);
    } finally {
      await alepha.stop();
    }
  });

  it("groups results by a declared dimension, computed from the SQL it actually generated", async () => {
    const { alepha, engine, provider } = await build();
    try {
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
    } finally {
      await alepha.stop();
    }
  });

  it("counts rows via sum(_sample_interval), not the sum of the measure", async () => {
    const { alepha, provider } = await build();
    try {
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
    } finally {
      await alepha.stop();
    }
  });

  it("keeps _sample_interval out of the WHERE clause", async () => {
    const { alepha, engine, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", app: "a", path: "/x", count: 1 },
      ]);

      await provider.query(dataset, {
        since: "2026-08-09",
        where: { app: "a" },
        select: { count: "sum" },
      });

      const whereClause =
        /WHERE([\s\S]*?)(?:GROUP BY|HAVING)/.exec(
          engine.lastQuery ?? "",
        )?.[1] ?? "";
      // `_sample_interval` is a property of the *sample*, not of the event —
      // filtering on it would bias the very correction it exists to enable.
      expect(whereClause).not.toContain("_sample_interval");
    } finally {
      await alepha.stop();
    }
  });

  it("sorts and limits client-side rather than splicing orderBy into SQL", async () => {
    const { alepha, engine, provider } = await build();
    try {
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
      // fetch, which is also what keeps a caller-chosen key from being
      // spliced into an `ORDER BY` clause as a raw identifier.
      expect(engine.lastQuery).not.toMatch(/ORDER BY/i);
      expect(engine.lastQuery).not.toMatch(/LIMIT/i);
    } finally {
      await alepha.stop();
    }
  });

  it("rejects a where filter that is not a declared dimension", async () => {
    const { alepha, provider } = await build();
    try {
      await expect(
        provider.query(dataset, {
          since: "2026-08-09",
          where: { "app; DROP TABLE app_analytics; --": "a" },
          select: { count: "sum" },
        }),
      ).rejects.toThrow(/unknown dimension/);
    } finally {
      await alepha.stop();
    }
  });

  it("rejects a select measure that is not a declared measure", async () => {
    const { alepha, provider } = await build();
    try {
      await expect(
        provider.query(dataset, {
          since: "2026-08-09",
          select: { "count; DROP TABLE app_analytics; --": "sum" },
        }),
      ).rejects.toThrow(/unknown measure/);
    } finally {
      await alepha.stop();
    }
  });

  it("returns no rows rather than a null-valued row when nothing matches", async () => {
    const { alepha, provider } = await build();
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

  it("registers with, and rolls up into, the same durable cold provider it delegates to", async () => {
    // Proves real delegation rather than "did not throw": `register()` has
    // to reach the exact `cold` instance `rollup()`/`prune()` also use, or
    // this would pass against an implementation that silently no-ops. Data
    // is seeded directly into `coldProvider` (bypassing Analytics Engine
    // entirely) so this stays a test of delegation, not of forwarding —
    // {@link forwardToCold} is covered on its own below.
    const { alepha, provider } = await buildRegistered();
    try {
      await provider.coldProvider.record(dataset, [
        { hour: "2026-08-01T10", app: "a", path: "/x", count: 4 },
      ]);

      // rollup()/prune() are asserted through `provider`, not
      // `provider.coldProvider`, directly — that is the delegation under
      // test.
      await provider.rollup(dataset, "2026-08-02");

      const rolled = await provider.coldProvider.query(dataset, {
        since: "2026-08-01",
        groupBy: ["day"],
        select: { count: "sum" },
      });
      expect(rolled.rows).toEqual([{ day: "2026-08-01", count: 4 }]);

      await provider.prune(dataset, "2026-08-03");

      const pruned = await provider.coldProvider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });
      expect(pruned.rows).toEqual([]);
    } finally {
      await alepha.stop();
    }
  });

  it("forwards Analytics Engine rows into cold before folding them", async () => {
    // Unlike the delegation test above, data is written through
    // `provider.record()` — i.e. it only ever exists in Analytics Engine —
    // so this proves `rollup()` itself moves it into `cold`, not merely that
    // `cold.rollup()` gets called.
    const { alepha, provider } = await buildRegistered();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", app: "a", path: "/x", count: 3 },
        { hour: "2026-08-01T11", app: "a", path: "/x", count: 2 },
      ]);

      await provider.rollup(dataset, "2026-08-02");

      const result = await provider.coldProvider.query(dataset, {
        since: "2026-08-01",
        groupBy: ["day"],
        select: { count: "sum" },
      });
      expect(result.rows).toEqual([{ day: "2026-08-01", count: 5 }]);
    } finally {
      await alepha.stop();
    }
  });

  it("does not double totals when rollup() runs twice", async () => {
    // The one that matters most: without the watermark, the second sweep
    // would re-query the same Analytics Engine rows (nothing ever deletes
    // them) and `cold.record()`'s accumulate-upsert would add them again.
    const { alepha, provider } = await buildRegistered();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", app: "a", path: "/x", count: 4 },
      ]);

      await provider.rollup(dataset, "2026-08-02");
      const once = await provider.coldProvider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });
      expect(once.rows).toEqual([{ count: 4 }]);

      await provider.rollup(dataset, "2026-08-02");
      const twice = await provider.coldProvider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });

      expect(twice.rows).toEqual(once.rows);
    } finally {
      await alepha.stop();
    }
  });

  it("forwards nothing and does not throw when the Analytics Engine window is empty", async () => {
    const { alepha, provider } = await buildRegistered();
    try {
      await expect(
        provider.rollup(dataset, "2026-08-02"),
      ).resolves.toBeUndefined();

      const result = await provider.coldProvider.query(dataset, {
        since: "1970-01-01",
        select: { count: "sum" },
      });
      expect(result.rows).toEqual([]);
    } finally {
      await alepha.stop();
    }
  });

  it("forwards the sample-corrected value into cold, not a raw stored double", async () => {
    const { alepha, provider, engine } = await buildRegistered();
    try {
      // `_sample_interval: 4` on a stored `count` of 10 means the corrected
      // total is 40 — the fake never simulates real sampling (see its class
      // doc), so `answer()` is the only way to produce an interval other
      // than 1 and prove `forwardToCold` uses `query()`'s corrected output
      // rather than reading `points[].doubles` itself.
      engine.answer([
        {
          hour: "2026-08-01T10",
          app: "a",
          path: "/x",
          count: "40",
          _sample_interval: "4",
        },
      ]);

      await provider.rollup(dataset, "2026-08-02");

      const result = await provider.coldProvider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });
      expect(result.rows).toEqual([{ count: 40 }]);
    } finally {
      await alepha.stop();
    }
  });
});

describe("WaeAnalyticsProvider selection", () => {
  // `alepha.isTest()` reads `NODE_ENV`, which vitest sets to `"test"` by
  // default — so proving the non-test branches means overriding it, the
  // same technique `$sms.spec.ts` uses to test `AlephaSms`'s own selection.
  it("selects WaeAnalyticsProvider when CLOUDFLARE_ANALYTICS_DATASET is set", () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        CLOUDFLARE_ANALYTICS_DATASET: BINDING_NAME,
      },
    })
      .with(AlephaOrmPostgres)
      .with(AlephaAnalytics);

    expect(alepha.inject(AnalyticsProvider)).toBeInstanceOf(
      WaeAnalyticsProvider,
    );
  });

  it("falls back to OrmAnalyticsProvider when no dataset is configured, so D1-only stays a valid deployment", () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "production" } })
      .with(AlephaOrmPostgres)
      .with(AlephaAnalytics);

    expect(alepha.inject(AnalyticsProvider)).toBeInstanceOf(
      OrmAnalyticsProvider,
    );
  });
});
