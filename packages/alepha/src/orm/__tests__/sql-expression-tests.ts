import { $inject, type Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";
import { DatabaseProvider } from "../core/providers/drivers/DatabaseProvider.ts";
import { SqlExpressionProvider } from "../core/providers/SqlExpressionProvider.ts";

export const sqlxEvents = $entity({
  name: "sqlx_events",
  schema: z.object({
    id: db.primaryKey(z.text()),
    startedAt: z.datetime(),
    endedAt: z.datetime().optional(),
  }),
});

class SqlxFixture {
  readonly events = $repository(sqlxEvents);
  readonly database = $inject(DatabaseProvider);
  readonly sqlx = $inject(SqlExpressionProvider);
}

/**
 * `dateDay` must return the same 'YYYY-MM-DD' text on both dialects for the
 * same instant — that uniformity is what lets one schema decode both.
 */
export const testDateDay = async (alepha: Alepha) => {
  const app = alepha.inject(SqlxFixture);
  await alepha.start();

  await app.events.create({
    id: "e1",
    startedAt: "2026-03-14T22:30:00.000Z",
  });

  const rows = await app.database.run(
    sql`SELECT ${app.sqlx.dateDay(app.events.table.startedAt)} AS day FROM ${app.events.table}`,
    z.object({ day: z.text() }),
  );

  expect(rows).toHaveLength(1);
  expect(rows[0].day).toBe("2026-03-14");
};

/**
 * ISO week boundaries are the interesting cases: 2026-01-01 is a Thursday, so
 * it belongs to ISO week 2026-W01, and 2025-12-29 (the Monday of that same
 * ISO week) must land on the identical label. Both dialects must agree —
 * today Postgres emits ISO weeks and SQLite emits `%W`, which are different
 * numbering schemes.
 */
export const testDateWeek = async (alepha: Alepha) => {
  const app = alepha.inject(SqlxFixture);
  await alepha.start();

  await app.events.createMany([
    { id: "w1", startedAt: "2026-01-01T12:00:00.000Z" },
    { id: "w2", startedAt: "2025-12-29T12:00:00.000Z" },
    { id: "w3", startedAt: "2026-03-14T12:00:00.000Z" },
  ]);

  const rows = await app.database.run(
    sql`SELECT ${app.events.table.id} AS id,
               ${app.sqlx.dateWeek(app.events.table.startedAt)} AS week
        FROM ${app.events.table} ORDER BY ${app.events.table.id}`,
    z.object({ id: z.text(), week: z.text() }),
  );

  expect(rows.map((row) => row.week)).toEqual([
    "2026-W01",
    "2026-W01",
    "2026-W11",
  ]);
};

/**
 * The exact shape a cycle-time metric needs: elapsed hours between two
 * timestamp columns, averaged. 36 hours apart must read as 36 on both
 * dialects — Postgres via EXTRACT(EPOCH), SQLite via the raw ms delta.
 *
 * The second row has a NULL `endedAt` on purpose: NULL must propagate so
 * AVG skips it rather than counting it as zero.
 */
export const testDateDiff = async (alepha: Alepha) => {
  const app = alepha.inject(SqlxFixture);
  await alepha.start();

  await app.events.createMany([
    {
      id: "d1",
      startedAt: "2026-03-14T00:00:00.000Z",
      endedAt: "2026-03-15T12:00:00.000Z",
    },
    { id: "d2", startedAt: "2026-03-14T00:00:00.000Z" },
  ]);

  const [row] = await app.database.run(
    sql`SELECT AVG(${app.sqlx.dateDiff(
      app.events.table.endedAt,
      app.events.table.startedAt,
      "hours",
    )}) AS hours FROM ${app.events.table}`,
    z.object({ hours: z.number() }),
  );

  expect(row.hours).toBeCloseTo(36, 5);
};

/**
 * A row three days old falls inside `ago(7, "days")` and outside
 * `ago(1, "days")`, on both dialects. Uses DateTimeProvider rather than
 * Date.now() so the fixture stays testable under time travel.
 */
export const testAgo = async (alepha: Alepha) => {
  const app = alepha.inject(SqlxFixture);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();

  const threeDaysAgo = new Date(
    dateTime.nowMillis() - 3 * 24 * 3600 * 1000,
  ).toISOString();
  await app.events.create({ id: "a1", startedAt: threeDaysAgo });

  const within = await app.database.run(
    sql`SELECT COUNT(*) AS n FROM ${app.events.table}
        WHERE ${app.events.table.startedAt} >= ${app.sqlx.ago(7, "days")}`,
    // `COUNT(*)` is the caller's SQL, not the helper's: Postgres returns
    // bigint as a string to protect precision, so real callers coerce here.
    z.object({ n: z.coerce.number() }),
  );
  const outside = await app.database.run(
    sql`SELECT COUNT(*) AS n FROM ${app.events.table}
        WHERE ${app.events.table.startedAt} >= ${app.sqlx.ago(1, "days")}`,
    // `COUNT(*)` is the caller's SQL, not the helper's: Postgres returns
    // bigint as a string to protect precision, so real callers coerce here.
    z.object({ n: z.coerce.number() }),
  );

  expect(within[0].n).toBe(1);
  expect(outside[0].n).toBe(0);
};
