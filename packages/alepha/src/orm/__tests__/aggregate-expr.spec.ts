import { $inject, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, expectTypeOf, it } from "vitest";

import { $entity, $repository, db, sql } from "../core/index.ts";
import { SqlExpressionProvider } from "../core/providers/SqlExpressionProvider.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const quests = $entity({
  name: "test_agg_expr_quests",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    priority: z.text(),
    assignee: z.text(),
    createdAt: z.datetime(),
    acceptedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),
    deletedAt: db.deletedAt(),
  }),
});

class App {
  quests = $repository(quests);
  sqlx = $inject(SqlExpressionProvider);
  dateTime = $inject(DateTimeProvider);
}

const H = 3600_000;

/**
 * Fixed instants, so day and ISO week labels are known. 2026-03-09 is a
 * Monday (ISO week 11); 2026-03-02 is the Monday of week 10.
 */
const seed = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const at = (iso: string, plusHours = 0) =>
    new Date(new Date(iso).getTime() + plusHours * H).toISOString();

  await app.quests.createMany([
    // high: cycles of 2h and 6h
    {
      priority: "high",
      assignee: "ana",
      createdAt: at("2026-03-02T09:00:00.000Z"),
      acceptedAt: at("2026-03-02T10:00:00.000Z"),
      completedAt: at("2026-03-02T10:00:00.000Z", 2),
    },
    {
      priority: "high",
      assignee: "bob",
      createdAt: at("2026-03-09T09:00:00.000Z"),
      acceptedAt: at("2026-03-09T10:00:00.000Z"),
      completedAt: at("2026-03-09T10:00:00.000Z", 6),
    },
    // low: one cycle of 24h, one never completed
    {
      priority: "low",
      assignee: "ana",
      createdAt: at("2026-03-09T09:00:00.000Z"),
      acceptedAt: at("2026-03-10T09:00:00.000Z"),
      completedAt: at("2026-03-10T09:00:00.000Z", 24),
    },
    {
      priority: "low",
      assignee: "ana",
      createdAt: at("2026-03-10T09:00:00.000Z"),
    },
  ]);

  // Soft-deleted: must count nowhere.
  const gone = await app.quests.create({
    priority: "high",
    assignee: "ana",
    createdAt: at("2026-03-09T09:00:00.000Z"),
    acceptedAt: at("2026-03-09T09:00:00.000Z"),
    completedAt: at("2026-03-09T09:00:00.000Z", 100),
  });
  await app.quests.deleteById(gone.id);

  return app;
};

/**
 * Burn-up: created per day, and completed per day.
 */
const testBurnUpByDay = async (alepha: Alepha) => {
  const app = await seed(alepha);
  const t = app.quests.table;

  const created = await app.quests.aggregate({
    select: {
      day: { expr: app.sqlx.dateDay(t.createdAt) },
      id: { count: true },
    },
    groupBy: ["day"],
    orderBy: "day",
  });
  expectTypeOf(created[0].day).toEqualTypeOf<string>();
  expect(created).toEqual([
    { day: "2026-03-02", id: { count: 1 } },
    { day: "2026-03-09", id: { count: 2 } },
    { day: "2026-03-10", id: { count: 1 } },
  ]);

  const completed = await app.quests.aggregate({
    select: {
      day: { expr: app.sqlx.dateDay(t.completedAt) },
      id: { count: true },
    },
    where: { completedAt: { isNotNull: true } },
    groupBy: ["day"],
    orderBy: { column: "day", direction: "desc" },
  });
  expect(completed).toEqual([
    { day: "2026-03-11", id: { count: 1 } },
    { day: "2026-03-09", id: { count: 1 } },
    { day: "2026-03-02", id: { count: 1 } },
  ]);
};

/**
 * Cycle time by priority: avg / min / max over a date difference, with a
 * having on the average.
 */
const testCycleTimeByPriority = async (alepha: Alepha) => {
  const app = await seed(alepha);
  const t = app.quests.table;
  const cycle = app.sqlx.dateDiff(t.completedAt, t.acceptedAt, "hours");

  const rows = await app.quests.aggregate({
    select: {
      priority: true,
      cycle: {
        avg: { expr: cycle },
        min: { expr: cycle },
        max: { expr: cycle },
        count: { expr: cycle },
      },
    },
    groupBy: ["priority"],
    orderBy: "priority",
  });
  expectTypeOf(rows[0].cycle.min).toEqualTypeOf<number | null>();
  expectTypeOf(rows[0].cycle.avg).toEqualTypeOf<number>();
  expect(rows.map((r) => [r.priority, r.cycle])).toEqual([
    ["high", { avg: 4, min: 2, max: 6, count: 2 }],
    ["low", { avg: 24, min: 24, max: 24, count: 1 }],
  ]);

  const slow = await app.quests.aggregate({
    select: { priority: true, cycle: { avg: { expr: cycle } } },
    groupBy: ["priority"],
    having: { cycle: { avg: { gt: 10 } } },
  });
  expect(slow.map((r) => r.priority)).toEqual(["low"]);

  const orderedByAvg = await app.quests.aggregate({
    select: { priority: true, cycle: { avg: { expr: cycle } } },
    groupBy: ["priority"],
    orderBy: { column: "cycle.avg", direction: "desc" },
  });
  expect(orderedByAvg.map((r) => r.priority)).toEqual(["low", "high"]);
};

/**
 * The KPI aggregate: a week window bounded from `DateTimeProvider` (not
 * `sqlx.ago()`, which reads the database clock), conditioned counts, and an
 * average cycle time conditioned by its own `where`.
 */
const testKpiWindows = async (alepha: Alepha) => {
  const app = await seed(alepha);
  const t = app.quests.table;
  const cycle = app.sqlx.dateDiff(t.completedAt, t.acceptedAt, "hours");

  app.dateTime.pause();
  await app.dateTime.travel(
    new Date("2026-03-12T00:00:00.000Z").getTime() - app.dateTime.nowMillis(),
    "millisecond",
  );
  const weekAgo = app.dateTime.now().subtract(7, "day").toISOString();

  const [kpi] = await app.quests.aggregate({
    select: {
      id: { count: true },
      createdThisWeek: {
        count: { column: "id", where: { createdAt: { gte: weekAgo } } },
      },
      cycle: { avg: { expr: cycle } },
      cycleThisWeek: {
        avg: { expr: cycle, where: { completedAt: { gte: weekAgo } } },
      },
    },
  });
  expect(kpi).toEqual({
    id: { count: 4 },
    createdThisWeek: { count: 3 },
    cycle: { avg: (2 + 6 + 24) / 3 },
    cycleThisWeek: { avg: (6 + 24) / 2 },
  });

  // The where filter itself takes the same bound, and an SQL fragment.
  const recent = await app.quests.aggregate({
    select: { id: { count: true } },
    where: { createdAt: { gte: weekAgo } },
  });
  expect(recent[0].id.count).toBe(3);
};

/**
 * The weekly contribution matrix: ISO week by assignee.
 */
const testWeeklyContributionMatrix = async (alepha: Alepha) => {
  const app = await seed(alepha);
  const t = app.quests.table;

  const rows = await app.quests.aggregate({
    select: {
      week: { expr: app.sqlx.dateWeek(t.completedAt) },
      assignee: true,
      id: { count: true },
    },
    where: { completedAt: { isNotNull: true } },
    groupBy: ["week", "assignee"],
    orderBy: [
      { column: "week", direction: "asc" },
      { column: "assignee", direction: "asc" },
    ],
  });
  expect(rows).toEqual([
    { week: "2026-W10", assignee: "ana", id: { count: 1 } },
    { week: "2026-W11", assignee: "ana", id: { count: 1 } },
    { week: "2026-W11", assignee: "bob", id: { count: 1 } },
  ]);
};

/**
 * The trap the alias rendering avoids: an expression binding a parameter.
 * Rendered twice it binds `$1` in the SELECT and `$2` in the GROUP BY, and
 * Postgres refuses the SELECT as not grouped.
 */
const testParameterBindingExpression = async (alepha: Alepha) => {
  const app = await seed(alepha);
  const t = app.quests.table;

  const rows = await app.quests.aggregate({
    select: {
      label: { expr: sql<string>`${t.priority} || ${"-"} || ${t.assignee}` },
      id: { count: true },
    },
    groupBy: ["label"],
    orderBy: "label",
  });
  expect(rows).toEqual([
    { label: "high-ana", id: { count: 1 } },
    { label: "high-bob", id: { count: 1 } },
    { label: "low-ana", id: { count: 2 } },
  ]);
};

const testRefusals = async (alepha: Alepha) => {
  const app = await seed(alepha);
  const t = app.quests.table;

  await expect(
    app.quests.aggregate({
      select: { priority: { expr: sql`1` } } as any,
    }),
  ).rejects.toThrow(/'priority' carries 'expr'/);

  await expect(
    app.quests.aggregate({
      select: { created_at: { expr: app.sqlx.dateDay(t.createdAt) } } as any,
    }),
  ).rejects.toThrow(/spelled like a column/);

  await expect(
    app.quests.aggregate({
      select: {
        both: { avg: { column: "id", expr: sql`1` } as any },
      },
    }),
  ).rejects.toThrow(/both 'column' and 'expr'/);
};

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

describe("aggregate over expressions", () => {
  it("groups burn-up counts by day (sqlite)", async () => {
    await testBurnUpByDay(sqlite());
  });

  it("groups burn-up counts by day (postgres)", async () => {
    await testBurnUpByDay(postgres());
  });

  it("aggregates cycle time by priority, with having and orderBy (sqlite)", async () => {
    await testCycleTimeByPriority(sqlite());
  });

  it("aggregates cycle time by priority, with having and orderBy (postgres)", async () => {
    await testCycleTimeByPriority(postgres());
  });

  it("computes KPI week windows from a DateTimeProvider bound (sqlite)", async () => {
    await testKpiWindows(sqlite());
  });

  it("computes KPI week windows from a DateTimeProvider bound (postgres)", async () => {
    await testKpiWindows(postgres());
  });

  it("builds the weekly contribution matrix (sqlite)", async () => {
    await testWeeklyContributionMatrix(sqlite());
  });

  it("builds the weekly contribution matrix (postgres)", async () => {
    await testWeeklyContributionMatrix(postgres());
  });

  it("groups by the alias of a parameter-binding expression (sqlite)", async () => {
    await testParameterBindingExpression(sqlite());
  });

  it("groups by the alias of a parameter-binding expression (postgres)", async () => {
    await testParameterBindingExpression(postgres());
  });

  it("refuses an expr alias spelled like a column, and column with expr", async () => {
    await testRefusals(sqlite());
  });
});
