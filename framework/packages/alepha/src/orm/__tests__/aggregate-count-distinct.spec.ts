import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db, sql } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const visits = $entity({
  name: "test_aggregate_count_distinct_visits",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    day: z.text(),
    visitor: z.text(),
    traffic: z.text(),
  }),
});

class App {
  repository = $repository(visits);
}

/**
 * Ann visits twice on day 1 and once on day 2, Bo once on day 1, and a bot
 * twice on day 2: every count below has a different answer.
 */
const seed = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await app.repository.deleteMany({});
  await app.repository.createMany([
    { day: "d1", visitor: "ann", traffic: "human" },
    { day: "d1", visitor: "ann", traffic: "human" },
    { day: "d1", visitor: "bo", traffic: "human" },
    { day: "d2", visitor: "ann", traffic: "human" },
    { day: "d2", visitor: "bot", traffic: "bot" },
    { day: "d2", visitor: "bot", traffic: "bot" },
  ]);
  return app;
};

const testCountDistinct = async (alepha: Alepha) => {
  const app = await seed(alepha);
  const t = app.repository.table;

  // Plain, conditioned, and over an expression, in one pass.
  const [all] = await app.repository.aggregate({
    select: {
      visitor: { countDistinct: true },
      humans: {
        countDistinct: { column: "visitor", where: { traffic: { ne: "bot" } } },
      },
      visitorDays: {
        countDistinct: { expr: sql`${t.day} || '|' || ${t.visitor}` },
      },
    },
  });
  expect(all).toEqual({
    visitor: { countDistinct: 3 },
    humans: { countDistinct: 2 },
    visitorDays: { countDistinct: 4 },
  });

  // Grouped, and over an empty set.
  const perDay = await app.repository.aggregate({
    select: { day: true, visitor: { countDistinct: true } },
    groupBy: ["day"],
    orderBy: "day",
  });
  expect(perDay).toEqual([
    { day: "d1", visitor: { countDistinct: 2 } },
    { day: "d2", visitor: { countDistinct: 2 } },
  ]);
  const [none] = await app.repository.aggregate({
    select: { visitor: { countDistinct: true } },
    where: { day: { eq: "d9" } },
  });
  expect(none).toEqual({ visitor: { countDistinct: 0 } });
};

describe("Repository.aggregate countDistinct", () => {
  it("counts distinct values, conditioned, over an expression and grouped (sqlite)", async () => {
    await testCountDistinct(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("counts distinct values, conditioned, over an expression and grouped (postgres)", async () => {
    await testCountDistinct(Alepha.create().with(AlephaOrmPostgres));
  });
});
