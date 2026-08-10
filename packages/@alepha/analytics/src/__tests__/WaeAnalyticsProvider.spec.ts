import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";
import { AlephaAnalytics } from "../index.workerd.ts";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";
import { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";
import { OrmAnalyticsProvider } from "../providers/OrmAnalyticsProvider.ts";
import { WaeAnalyticsProvider } from "../providers/WaeAnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type { AnalyticsQuery } from "../schemas/analyticsQuerySchema.ts";
import { FakeAnalyticsEngine } from "./FakeAnalyticsEngine.ts";

const dataset = {
  name: "wae_views",
  index: "appId",
  dimensions: z.object({ appId: z.string(), path: z.string() }),
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
 *
 * Always registers `dataset` before `start()` — required for `cold`'s tables
 * to exist at all (registering after `start()` never gets migrated; see
 * `OrmAnalyticsProvider`'s own eager-registration rule) — which used to be a
 * separate `buildRegistered()` helper reserved for tests that touched `cold`
 * directly. `query()` now consults `cold` on every call whose window might
 * reach it (see `mightNeedCold`), so *every* test needs it registered, not
 * just the ones that used to opt in.
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
  provider.register(dataset);
  await alepha.start();
  return { alepha, provider, engine: provider.fakeEngine };
};

/**
 * Pins `alepha`'s `DateTimeProvider` to an exact instant, computing the
 * offset dynamically so this works regardless of the real wall-clock date
 * the suite happens to run on — required for `mightNeedCold`'s
 * `dataset.retention.hot`-relative "is this window still fully inside
 * Analytics Engine's live range" check, the one piece of `query()` that
 * reads the clock.
 */
const pinNow = async (alepha: Alepha, iso: string) => {
  const dateTime = alepha.inject(DateTimeProvider);
  dateTime.pause();
  const offset = Date.parse(iso) - dateTime.nowMillis();
  await dateTime.travel([offset, "milliseconds"]);
};

describe("WaeAnalyticsProvider", () => {
  it("writes the dataset name into blob1 so datasets can share a binding", async () => {
    const { alepha, engine, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 1 },
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
        { hour: "2026-08-09T05", appId: "a", path: "/x", count: 1 },
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
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 1 },
      ]);

      const map = AnalyticsSlotMap.forDataset(dataset);
      const blobs = engine.points[0]?.blobs ?? [];
      expect(blobs[map.blobSlot("appId") - 1]).toBe("a");
      expect(blobs[map.blobSlot("path") - 1]).toBe("/x");
    } finally {
      await alepha.stop();
    }
  });

  it("indexes on the declared index dimension", async () => {
    const { alepha, engine, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 1 },
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
          { hour: "2026-08-09T10", appId: "a", path: "/x", count: 1 },
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
        where: { appId: { inArray: [] } },
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
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 3 },
        { hour: "2026-08-09T11", appId: "a", path: "/y", count: 9 },
        { hour: "2026-08-09T12", appId: "a", path: "/x", count: 2 },
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
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 5 },
        { hour: "2026-08-09T11", appId: "a", path: "/y", count: 7 },
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
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 1 },
      ]);

      await provider.query(dataset, {
        since: "2026-08-09",
        where: { appId: "a" },
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
        { hour: "2026-08-09T10", appId: "a", path: "/low", count: 1 },
        { hour: "2026-08-09T10", appId: "a", path: "/high", count: 5 },
        { hour: "2026-08-09T10", appId: "a", path: "/mid", count: 3 },
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
      // `query()` now runs the Analytics Engine side and the `cold` side
      // concurrently (`Promise.all`), and both independently validate
      // `where`'s keys against `dataset`'s declared dimensions — this
      // class's own `AnalyticsSlotMap.blobSlot` ("unknown dimension") and
      // `OrmAnalyticsProvider.assertKnownDimension` ("not a declared
      // dimension"). Either can be the one `Promise.all` surfaces first, so
      // the assertion has to accept both rather than assume which wins.
      await expect(
        provider.query(dataset, {
          since: "2026-08-09",
          where: { "app; DROP TABLE app_analytics; --": "a" },
          select: { count: "sum" },
        }),
      ).rejects.toThrow(/unknown dimension|not a declared dimension/);
    } finally {
      await alepha.stop();
    }
  });

  it("rejects a select measure that is not a declared measure", async () => {
    const { alepha, provider } = await build();
    try {
      // See the sibling test above for why both error sources are accepted.
      await expect(
        provider.query(dataset, {
          since: "2026-08-09",
          select: { "count; DROP TABLE app_analytics; --": "sum" },
        }),
      ).rejects.toThrow(/unknown measure|not a declared measure/);
    } finally {
      await alepha.stop();
    }
  });

  it("returns no rows rather than a null-valued row when nothing matches", async () => {
    const { alepha, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 1 },
      ]);

      const result = await provider.query(dataset, {
        since: "2026-08-09",
        where: { appId: { inArray: ["nonexistent"] } },
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
    const { alepha, provider } = await build();
    try {
      await provider.coldProvider.record(dataset, [
        { hour: "2026-08-01T10", appId: "a", path: "/x", count: 4 },
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
    const { alepha, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", appId: "a", path: "/x", count: 3 },
        { hour: "2026-08-01T11", appId: "a", path: "/x", count: 2 },
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
    const { alepha, provider } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", appId: "a", path: "/x", count: 4 },
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
    const { alepha, provider } = await build();
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
    const { alepha, provider, engine } = await build();
    try {
      // `_sample_interval: 4` on a stored `count` of 10 means the corrected
      // total is 40 — the fake never simulates real sampling (see its class
      // doc), so `answer()` is the only way to produce an interval other
      // than 1 and prove `forwardToCold` uses `query()`'s corrected output
      // rather than reading `points[].doubles` itself.
      engine.answer([
        {
          hour: "2026-08-01T10",
          appId: "a",
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

describe("WaeAnalyticsProvider — the read side merges with cold", () => {
  it("skips cold entirely for a window inside the declared hot retention", async () => {
    // A call-counting substitute for `cold` — `.with({ provide, use })`
    // works here because `CountingOrmAnalyticsProvider extends
    // OrmAnalyticsProvider` (inherits its protected DB-dependent internals
    // rather than reimplementing them), the same requirement that makes
    // `coldProvider` on `TestWaeAnalyticsProvider` a getter into the real
    // thing rather than a lightweight double.
    class CountingOrmAnalyticsProvider extends OrmAnalyticsProvider {
      public queryCount = 0;
      public override async query(target: AnalyticsDataset, q: AnalyticsQuery) {
        this.queryCount++;
        return super.query(target, q);
      }
    }

    const hotDataset = { ...dataset, retention: { hot: "5d" } };
    const alepha = Alepha.create({
      env: {
        CLOUDFLARE_ANALYTICS_DATASET: BINDING_NAME,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: API_TOKEN,
      },
    })
      .with(AlephaOrmPostgres)
      .with({
        provide: OrmAnalyticsProvider,
        use: CountingOrmAnalyticsProvider,
      });

    const provider = alepha.inject(TestWaeAnalyticsProvider);
    alepha.set("cloudflare.env", { [BINDING_NAME]: provider.fakeEngine });
    provider.register(hotDataset);
    await alepha.start();

    try {
      await pinNow(alepha, "2026-08-09T00:00:00.000Z");

      await provider.record(hotDataset, [
        { hour: "2026-08-08T10", appId: "a", path: "/x", count: 3 },
      ]);

      // since = 2026-08-05, hot floor = 2026-08-09 - 5d = 2026-08-04: the
      // whole window is at/after the floor, so `cold` cannot have anything
      // extra for it in a correctly-running system.
      const result = await provider.query(hotDataset, {
        since: "2026-08-05",
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([{ count: 3 }]);
      const cold =
        provider.coldProvider as unknown as CountingOrmAnalyticsProvider;
      expect(cold.queryCount).toBe(0);
    } finally {
      await alepha.stop();
    }
  });

  it("returns cold's data for a window entirely older than what Analytics Engine still has reachable — the case that returned nothing before this fix", async () => {
    const { alepha, provider, engine } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", appId: "a", path: "/x", count: 4 },
      ]);
      await provider.rollup(dataset, "2026-08-02");

      // The fake, unlike real Analytics Engine, never drops a point on its
      // own — so without this, the query below would pass even with `cold`
      // never consulted at all, simply because Analytics Engine still
      // happens to have the same point. `answer()` simulates the point
      // having genuinely aged out of Analytics Engine's own retention (it
      // overrides only the one Analytics Engine call this query issues),
      // which is the scenario this test actually means to cover: a row that
      // exists ONLY in `cold` because it no longer exists in Analytics
      // Engine at all.
      engine.answer([]);

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([{ count: 4 }]);
      // Every contributing row came from `cold` — exact, not sampled.
      expect(result.estimated).toBe(false);
    } finally {
      await alepha.stop();
    }
  });

  it("returns the union across a window straddling the forwarded boundary, totals equal to the sum of both parts", async () => {
    const { alepha, provider, engine } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", appId: "a", path: "/x", count: 4 },
      ]);
      await provider.rollup(dataset, "2026-08-02");

      // Recorded after the rollup — still only in Analytics Engine.
      await provider.record(dataset, [
        { hour: "2026-08-09T10", appId: "a", path: "/x", count: 7 },
      ]);

      // Simulates the old point having genuinely aged out of Analytics
      // Engine, the same as the test above — Analytics Engine now reports
      // only the new point (7), so a correct total of 11 can only have come
      // from also reading `cold`.
      engine.answer([{ count: "7" }]);

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([{ count: 11 }]);
      // Analytics Engine contributed a row (the new one), so the merged
      // result stays an estimate even though the old part is exact.
      expect(result.estimated).toBe(true);
    } finally {
      await alepha.stop();
    }
  });

  it("does not double-count an hour that exists in both Analytics Engine and cold", async () => {
    const { alepha, provider, engine } = await build();
    try {
      await provider.record(dataset, [
        { hour: "2026-08-01T10", appId: "a", path: "/x", count: 4 },
      ]);
      await provider.rollup(dataset, "2026-08-02");

      // Analytics Engine has no delete API: the point recorded above is
      // still sitting in `engine.points`, untouched by rollup, at the same
      // time its corrected total also lives in `cold`'s rolled tier. An
      // unconditional merge of both sources would count it twice.
      expect(engine.points).toHaveLength(1);

      const result = await provider.query(dataset, {
        since: "2026-08-01",
        select: { count: "sum" },
      });

      expect(result.rows).toEqual([{ count: 4 }]);
    } finally {
      await alepha.stop();
    }
  });

  it("orderBy + limit across a straddling window return the globally correct top-N, not a per-source top-N", async () => {
    const { alepha, provider } = await build();
    try {
      // Old, forwarded to cold: "/a" and "/shared" each rank ABOVE nothing —
      // there are only two cold groups, so a per-source limit of 1 would
      // keep "/a" (10 > 9) and drop "/shared".
      await provider.record(dataset, [
        { hour: "2026-08-01T10", appId: "a", path: "/a", count: 10 },
        { hour: "2026-08-01T11", appId: "a", path: "/shared", count: 9 },
      ]);
      await provider.rollup(dataset, "2026-08-02");

      // New, still only in Analytics Engine: symmetric shape — a
      // per-source limit of 1 there would keep "/b" (10 > 9) and drop
      // "/shared" too.
      await provider.record(dataset, [
        { hour: "2026-08-09T10", appId: "a", path: "/b", count: 10 },
        { hour: "2026-08-09T11", appId: "a", path: "/shared", count: 9 },
      ]);

      // Per-source top-1 would therefore never see "/shared" at all in
      // either source and could only ever return "/a" or "/b" (each 10).
      // The true global total for "/shared" is 9 + 9 = 18 — higher than
      // either "/a" or "/b" alone — so only a merge-then-limit is correct.
      const result = await provider.query(dataset, {
        since: "2026-08-01",
        groupBy: ["path"],
        select: { count: "sum" },
        orderBy: { key: "count", direction: "desc" },
        limit: 1,
      });

      expect(result.rows).toEqual([{ path: "/shared", count: 18 }]);
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
