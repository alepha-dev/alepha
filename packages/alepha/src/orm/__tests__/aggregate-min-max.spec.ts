import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const readings = $entity({
  name: "test_aggregate_readings",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    name: z.text(),
    amount: z.integer(),
    takenAt: z.datetime(),
    createdAt: db.createdAt(),
  }),
});

class App {
  repository = $repository(readings);
}

/**
 * Every aggregate value used to be run through `Number()`, so `min` / `max`
 * on anything that is not a number came back `NaN` while the result type
 * insisted it was a number.
 */
const testMinMaxKeepTheColumnType = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await app.repository.deleteMany({});

  const early = new Date("2026-01-02T03:04:05.000Z");
  const late = new Date("2026-06-07T08:09:10.000Z");

  await app.repository.createMany([
    { name: "alpha", amount: 10, takenAt: early.toISOString() },
    { name: "omega", amount: 32, takenAt: late.toISOString() },
  ]);

  const [row] = await app.repository.aggregate({
    select: {
      name: { min: true, max: true },
      takenAt: { min: true, max: true },
      createdAt: { max: true },
      amount: { count: true, sum: true, avg: true, min: true, max: true },
    },
  });

  expect(row.name.min).toBe("alpha");
  expect(row.name.max).toBe("omega");

  // Timestamps come back in whatever shape the column decodes to - an ISO
  // string on sqlite, a postgres timestamp literal on postgres - which is the
  // point: the column's own value, not a number it could never be. Compared as
  // instants so the assertion holds on both.
  expect(new Date(row.takenAt.min as string).getTime()).toBe(early.getTime());
  expect(new Date(row.takenAt.max as string).getTime()).toBe(late.getTime());
  expect(new Date(row.createdAt.max as string).getTime()).not.toBeNaN();

  // The numeric aggregates are unchanged, and still need the coercion: the
  // driver hands back sum() and avg() as strings.
  expect(row.amount.count).toBe(2);
  expect(row.amount.sum).toBe(42);
  expect(row.amount.avg).toBe(21);
  expect(row.amount.min).toBe(10);
  expect(row.amount.max).toBe(32);
};

/**
 * SQL has no minimum of nothing. Reporting `0` there would be indistinguishable
 * from a real zero, and on a text column it was `NaN`.
 */
const testEmptySet = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  await app.repository.deleteMany({});

  const [row] = await app.repository.aggregate({
    select: { name: { min: true }, amount: { count: true, sum: true } },
  });

  expect(row.name.min).toBeNull();
  expect(row.amount.count).toBe(0);
  expect(row.amount.sum).toBe(0);
};

describe("aggregate min/max keep the column type", () => {
  it("returns strings and timestamps, not NaN (sqlite)", async () => {
    await testMinMaxKeepTheColumnType(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("returns strings and timestamps, not NaN (postgres)", async () => {
    await testMinMaxKeepTheColumnType(Alepha.create().with(AlephaOrmPostgres));
  });

  it("answers null over an empty set (sqlite)", async () => {
    await testEmptySet(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("answers null over an empty set (postgres)", async () => {
    await testEmptySet(Alepha.create().with(AlephaOrmPostgres));
  });
});
