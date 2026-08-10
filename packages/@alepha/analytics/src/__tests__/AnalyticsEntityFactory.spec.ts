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
        ["app", "time_bucket", "count", "path"].sort(),
      );
    }
  });

  it("rejects a dimension named after the reserved time column", () => {
    expect(() =>
      AnalyticsEntityFactory.build({
        ...dataset,
        dimensions: z.object({ app: z.string(), time_bucket: z.string() }),
      }),
    ).toThrow(/'time_bucket'.*reserved for the time bucket/);
  });

  it("rejects a name declared as both a dimension and a measure", () => {
    expect(() =>
      AnalyticsEntityFactory.build({
        ...dataset,
        dimensions: z.object({ app: z.string(), count: z.string() }),
        measures: z.object({ count: z.number() }),
      }),
    ).toThrow(/'count'.*both a dimension and a measure/);
  });

  it("rejects a dataset name that is not a legal table-name fragment", () => {
    expect(() =>
      AnalyticsEntityFactory.build({ ...dataset, name: "Bad-Name" }),
    ).toThrow(/'Bad-Name' is not a legal table-name fragment/);
  });

  it("builds cleanly for the conformance fixture's own shape, with 'bucket' surviving as a real dimension", () => {
    // This is the shape `analyticsConformance.ts` uses for every provider:
    // a histogram bucket index modelled as an ordinary dimension, alongside
    // a `samples` measure. It is the case the original reserved-column bug
    // silently broke — `bucket` the dimension would have overwritten the
    // reserved time column, and the unique index would have carried a
    // duplicate `bucket` entry.
    const conformanceDataset = {
      name: "conformance_views",
      index: "app",
      dimensions: z.object({
        app: z.string(),
        path: z.string(),
        bucket: z.number(),
      }),
      measures: z.object({ samples: z.number() }),
    };

    const { raw, rolled } = AnalyticsEntityFactory.build(conformanceDataset);
    for (const entity of [raw, rolled]) {
      expect(Object.keys(entity.options.schema.shape).sort()).toEqual(
        ["app", "bucket", "path", "samples", "time_bucket"].sort(),
      );
      // `bucket` is a genuine dimension column here, distinct from the
      // reserved `time_bucket` time column — neither was overwritten.
      expect(entity.options.schema.shape.bucket).toBeDefined();
      expect(entity.options.schema.shape.time_bucket).toBeDefined();
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
