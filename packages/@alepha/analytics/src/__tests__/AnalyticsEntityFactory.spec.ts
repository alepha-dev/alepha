import { Alepha, z } from "alepha";
import { DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";
import { AnalyticsEntityFactory } from "../services/AnalyticsEntityFactory.ts";

const dataset = {
  name: "page_views",
  index: "app",
  dimensions: z.object({ app: z.string(), path: z.string() }),
  measures: z.object({ count: z.number() }),
};

describe("AnalyticsEntityFactory", () => {
  it("derives a raw and a rolled table from the dataset name", () => {
    const { raw, rolled } = AnalyticsEntityFactory.build(dataset);
    expect(raw.name).toBe("analytics_page_views_raw");
    expect(rolled.name).toBe("analytics_page_views_rolled");
  });

  it("gives both tables the same dimension and measure columns", () => {
    const { raw, rolled } = AnalyticsEntityFactory.build(dataset);
    for (const entity of [raw, rolled]) {
      expect(Object.keys(entity.options.schema.shape).sort()).toEqual(
        ["app", "bucket", "count", "path"].sort(),
      );
    }
  });

  it("registers its tables with the database so migrations can see them", async () => {
    // The root `vitest.config.ts` pins `DATABASE_URL` to the docker-compose
    // Postgres for every test in the repo, so `alepha/orm`'s own SQLite
    // default (auto-selected the moment `DatabaseProvider` is injected)
    // rejects that URL outright. `AlephaOrmPostgres` is the module every
    // other DB-backed spec in this repo pulls in for exactly that reason —
    // see e.g. `packages/alepha/src/api/users/__tests__/RealmProvider.spec.ts`.
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const database = alepha.inject(DatabaseProvider);
    const { raw, rolled } = AnalyticsEntityFactory.build(dataset);

    database.registerEntity(raw as never);
    database.registerEntity(rolled as never);
    await alepha.start();

    try {
      // `database.table()` only proves the entity is in the provider's
      // in-memory map. Running a real `SELECT` against each table proves the
      // dev-sync (`alepha.start()` -> `DrizzleKitProvider.synchronize()`)
      // actually created them in the ephemeral test schema — the same push
      // that puts a table into a migration snapshot in non-test mode.
      const rawRows = await database.db
        .select()
        .from(database.table(raw as never))
        .limit(0);
      const rolledRows = await database.db
        .select()
        .from(database.table(rolled as never))
        .limit(0);
      expect(rawRows).toEqual([]);
      expect(rolledRows).toEqual([]);
    } finally {
      await alepha.stop();
    }
  });
});
