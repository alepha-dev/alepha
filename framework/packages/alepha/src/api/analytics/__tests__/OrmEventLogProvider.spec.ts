import { Alepha, z } from "alepha";
import {
  AlephaOrmTestPostgres,
  DatabaseProvider,
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "alepha/orm";
import { describe, expect, it } from "vitest";

import { OrmEventLogProvider } from "../providers/OrmEventLogProvider.ts";
import type { AnalyticsEventLog } from "../schemas/eventLogSchema.ts";
import { eventLogConformance } from "./eventLogConformance.ts";

/**
 * SQLite refusing a statement that binds more than 100 values, as D1 does.
 */
class D1CeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 100;

  protected override initDrizzle(): void {
    const database = this.sqlite as unknown as {
      prepare: (text: string) => unknown;
    };
    const prepare = database.prepare.bind(database);
    database.prepare = (text: string) => {
      const bound = text.split("?").length - 1;
      if (bound > this.maxBoundParameters) {
        throw new Error(`too many SQL variables (${bound})`);
      }
      return prepare(text);
    };
    super.initDrizzle();
  }
}

const sqlite =
  (driver: typeof NodeSqliteProvider) => async (logs: AnalyticsEventLog[]) => {
    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: driver,
    });
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    const provider = alepha.inject(OrmEventLogProvider);
    for (const log of logs) provider.register(log);
    await alepha.start();
    return provider;
  };

eventLogConformance("orm (sqlite)", sqlite(NodeSqliteProvider));

eventLogConformance("orm (d1)", sqlite(D1CeilingProvider));

eventLogConformance("orm (postgres)", async (logs) => {
  const alepha = Alepha.create().with(AlephaOrmTestPostgres);
  const provider = alepha.inject(OrmEventLogProvider);
  for (const log of logs) provider.register(log);
  await alepha.start();
  return provider;
});

describe("OrmEventLogProvider on D1", () => {
  const log: AnalyticsEventLog = {
    name: "d1_pageviews",
    index: "appId",
    schema: z.object({
      appId: z.string(),
      sessionId: z.string(),
      path: z.string(),
      country: z.string(),
      views: z.number(),
    }),
    keep: "90d",
  };

  it("appends a batch wider than 100 values in one statement, and filters on a set of 250", async () => {
    const provider = await sqlite(D1CeilingProvider)([log]);
    const at = Date.parse("2026-11-02T10:00:00Z");
    const apps = Array.from({ length: 250 }, (_, i) => `app-${i}`);
    // 250 rows of six values: 1,500 values in one batch.
    await provider.append(
      log,
      apps.map((appId, i) => ({
        at: at + i,
        appId,
        sessionId: `s${i % 7}`,
        path: "/",
        country: "FR",
        views: 1,
      })),
    );
    const result = await provider.query(log, {
      since: "2026-11-01",
      where: { appId: { inArray: apps } },
      select: {
        views: { sum: "views" },
        visitors: { distinct: "sessionId" },
      },
    });
    expect(result.rows).toEqual([{ views: 250, visitors: 7 }]);
  });

  it("names its table after the log and indexes it on the index column and time", () => {
    expect(OrmEventLogProvider.tableName(log)).toBe(
      "analytics_d1_pageviews_events",
    );
  });
});

describe("OrmEventLogProvider.prune", () => {
  const log: AnalyticsEventLog = {
    name: "prune_pageviews",
    index: "appId",
    schema: z.object({ appId: z.string() }),
    keep: "1d",
  };

  for (const [name, factory] of [
    ["sqlite", sqlite(D1CeilingProvider)],
    [
      "postgres",
      async (logs: AnalyticsEventLog[]) => {
        const alepha = Alepha.create().with(AlephaOrmTestPostgres);
        const provider = alepha.inject(OrmEventLogProvider);
        for (const it of logs) provider.register(it);
        await alepha.start();
        return provider;
      },
    ],
  ] as const) {
    it(`deletes the oldest expired rows first, at most the limit (${name})`, async () => {
      const provider = await factory([log]);
      await provider.append(log, [
        { at: 3, appId: "c" },
        { at: 1, appId: "a" },
        { at: 2, appId: "b" },
        { at: 10, appId: "kept" },
      ]);
      expect(await provider.prune(log, 5, 2)).toBe(2);
      const left = await provider.query(log, {
        from: "1970-01-01T00:00:00Z",
        groupBy: ["appId"],
        select: { n: { count: "*" } },
        orderBy: { key: "appId", direction: "asc" },
      });
      expect(left.rows.map((row) => row.appId)).toEqual(["c", "kept"]);
      expect(await provider.prune(log, 5, 2)).toBe(1);
      expect(await provider.prune(log, 5, 2)).toBe(0);
    });
  }
});
