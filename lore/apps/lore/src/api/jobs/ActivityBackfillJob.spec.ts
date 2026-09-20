import { Alepha, z } from "alepha";
import { audits } from "alepha/api/audits";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import {
  $repository,
  AlephaOrm,
  DatabaseProvider,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { analyticsBackfills } from "../entities/analyticsBackfills.ts";
import { LoreAnalytics } from "../entities/loreAnalytics.ts";
import { LoreApi } from "../index.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ActivityBackfillJob } from "./ActivityBackfillJob.ts";

/**
 * A real uuid, because `audits.userId` is `z.uuid()` and the repository
 * validates on write.
 */
const USER = "11111111-1111-4111-8111-111111111111";

class BackfillRepositories {
  audits = $repository(audits);
  backfills = $repository(analyticsBackfills);
}

/**
 * The job with its protected entry points reachable - the TestProvider
 * pattern this repo uses instead of reaching into a private.
 *
 * Substituted for the real one rather than injected beside it: a `$job` name
 * is registered once per container, so a second instance throws "Job already
 * registered".
 */
class TestActivityBackfillJob extends ActivityBackfillJob {
  public readonly testRun = this.run.bind(this);
  public readonly testFold = this.fold.bind(this);
}

interface TestContext {
  alepha: Alepha;
  job: TestActivityBackfillJob;
  audits: LoreAudits;
  datasets: LoreAnalytics;
  repos: BackfillRepositories;
  database: DatabaseProvider;
  sqlx: SqlExpressionProvider;
  dateTime: DateTimeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  // Before `LoreApi`, which lists the real job in its services.
  alepha.with({
    provide: ActivityBackfillJob,
    use: TestActivityBackfillJob,
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(BackfillRepositories);
  const job = alepha.inject(ActivityBackfillJob) as TestActivityBackfillJob;
  await alepha.start();

  return {
    alepha,
    job,
    audits: alepha.inject(LoreAudits),
    datasets: alepha.inject(LoreAnalytics),
    repos,
    database: alepha.inject(DatabaseProvider),
    sqlx: alepha.inject(SqlExpressionProvider),
    dateTime: alepha.inject(DateTimeProvider),
  };
};

/**
 * What the query this replaces would answer: `SUM(event_count)` over the same
 * fourteen-day, project-scoped window, per project per day.
 *
 * Written out here rather than reused from `HomeController`, on purpose - the
 * whole point of the rehearsal is that two independently written statements
 * come out with the same number.
 */
const auditTotals = async (ctx: TestContext): Promise<Map<string, number>> => {
  const table = ctx.repos.audits.table;
  const day = ctx.sqlx.dateDay(table.createdAt);
  const rows = await ctx.database.run(
    sql`
      SELECT ${table.scopeId} AS scope_id, ${day} AS day, SUM(${table.eventCount}) AS n
      FROM ${table}
      WHERE ${table.scopeType} = 'project'
        AND ${table.createdAt} >= ${ctx.sqlx.ago(
          ActivityBackfillJob.WINDOW_DAYS,
          "days",
        )}
      GROUP BY ${table.scopeId}, ${day}
    `,
    z.object({
      scope_id: z.text(),
      day: z.string(),
      n: z.coerce.number(),
    }),
  );
  return new Map(
    rows.map((row) => [`${row.scope_id}|${row.day}`, Number(row.n)]),
  );
};

/**
 * The same question asked of the dataset.
 */
const datasetTotals = async (
  ctx: TestContext,
): Promise<Map<string, number>> => {
  const result = await ctx.datasets.activity.query({
    since: "2000-01-01",
    groupBy: ["day", "project"],
    select: { count: "sum" },
  });
  return new Map(
    result.rows.map((row) => [
      `${String(row.project)}|${String(row.day)}`,
      Number(row.count),
    ]),
  );
};

/**
 * An audit row written straight to the table, below `LoreAuditService`.
 *
 * That is the production state this job exists for: fourteen days of rows
 * that predate the dataset, so nothing recorded a point for them. Going
 * through `$audit.log` instead would record one and leave nothing to
 * backfill.
 */
const seedRow = async (
  ctx: TestContext,
  row: {
    type: string;
    action: string;
    scopeId?: string;
    userId?: string;
    eventCount: number;
    daysAgo: number;
  },
): Promise<void> => {
  await ctx.repos.audits.create({
    type: row.type,
    action: row.action,
    ...(row.scopeId ? { scopeType: "project", scopeId: row.scopeId } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    eventCount: row.eventCount,
    success: true,
    severity: "info",
    createdAt: new Date(
      ctx.dateTime.nowMillis() - row.daysAgo * 24 * 60 * 60 * 1000,
    ).toISOString(),
  } as never);
};

describe("ActivityBackfillJob", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("folds the audit window the way the query it replaces sums it", async ({
    expect,
  }) => {
    await seedRow(ctx, {
      type: "quest",
      action: "update",
      scopeId: "1",
      userId: USER,
      eventCount: 7,
      daysAgo: 3,
    });
    await seedRow(ctx, {
      type: "folio",
      action: "create",
      scopeId: "1",
      userId: USER,
      eventCount: 1,
      daysAgo: 3,
    });
    await seedRow(ctx, {
      type: "epic",
      action: "create",
      scopeId: "2",
      eventCount: 2,
      daysAgo: 9,
    });
    // App layer, no scope: it must reach neither the fold nor the dataset.
    await seedRow(ctx, {
      type: "user",
      action: "login",
      userId: USER,
      eventCount: 4,
      daysAgo: 2,
    });
    // Outside the window: older than fourteen days.
    await seedRow(ctx, {
      type: "quest",
      action: "create",
      scopeId: "1",
      userId: USER,
      eventCount: 99,
      daysAgo: 20,
    });

    const tuples = await ctx.job.testFold();

    const byProject = new Map<string, number>();
    for (const tuple of tuples) {
      byProject.set(
        tuple.project,
        (byProject.get(tuple.project) ?? 0) + tuple.count,
      );
    }
    expect(byProject.get("1")).toBe(8);
    expect(byProject.get("2")).toBe(2);
    expect(byProject.size).toBe(2);

    // `SUM(event_count)`, never `COUNT(*)`: the coalesced row carrying seven
    // is seven events, not one.
    expect(tuples.find((tuple) => tuple.action === "update")?.count).toBe(7);

    // The bucket is what `$analytics` stores - an hour, not a day and not an
    // ISO timestamp.
    for (const tuple of tuples) {
      expect(tuple.hour).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    }

    // And the actor falls back the way the live path does.
    expect(tuples.find((tuple) => tuple.project === "2")?.actor).toBe("system");
  });

  it("leaves the dataset answering exactly what the audits query answers", async ({
    expect,
  }) => {
    await seedRow(ctx, {
      type: "quest",
      action: "update",
      scopeId: "1",
      userId: USER,
      eventCount: 7,
      daysAgo: 3,
    });
    await seedRow(ctx, {
      type: "folio",
      action: "create",
      scopeId: "1",
      userId: USER,
      eventCount: 1,
      daysAgo: 3,
    });
    await seedRow(ctx, {
      type: "epic",
      action: "create",
      scopeId: "2",
      eventCount: 2,
      daysAgo: 9,
    });
    await seedRow(ctx, {
      type: "user",
      action: "login",
      userId: USER,
      eventCount: 4,
      daysAgo: 2,
    });

    await ctx.job.testRun();

    expect(await datasetTotals(ctx)).toEqual(await auditTotals(ctx));

    const [receipt] = await ctx.repos.backfills.findMany({});
    expect(receipt.dataset).toBe("project_activity");
    // Ten project-scoped events; the four app-layer ones are not counted.
    expect(receipt.events).toBe(10);
    expect(receipt.points).toBe(3);
    expect(receipt.skippedHours).toBe(0);
  });

  it("skips a (project, hour) the live recording already owns", async ({
    expect,
  }) => {
    // Recorded through the real path, so the dataset holds this hour.
    await ctx.audits.quest.logSuccess("create", {
      ...ctx.audits.scope(1),
      userId: USER,
    });
    const live = await datasetTotals(ctx);
    // A second project's event in the same hour, written below the service,
    // so its (project, hour) is NOT taken.
    await seedRow(ctx, {
      type: "folio",
      action: "create",
      scopeId: "2",
      eventCount: 3,
      daysAgo: 0,
    });

    await ctx.job.testRun();

    const after = await datasetTotals(ctx);
    // Project 1's hour was skipped whole: its total did not move.
    for (const [key, value] of live) {
      expect(after.get(key)).toBe(value);
    }
    // Project 2's was not: the pair is per project, not per hour.
    const day = new Date(ctx.dateTime.nowMillis()).toISOString().slice(0, 10);
    expect(after.get(`2|${day}`)).toBe(3);

    const [receipt] = await ctx.repos.backfills.findMany({});
    expect(receipt.skippedHours).toBe(1);
    expect(receipt.events).toBe(3);
  });

  it("refuses a second pass, because Analytics Engine cannot be un-written", async ({
    expect,
  }) => {
    await seedRow(ctx, {
      type: "quest",
      action: "create",
      scopeId: "1",
      userId: USER,
      eventCount: 5,
      daysAgo: 1,
    });
    await ctx.repos.backfills.create({
      dataset: "project_activity",
      windowFrom: "2026-09-01T00",
      windowTo: "2026-09-15T00",
      points: 0,
      events: 0,
      skippedHours: 0,
    });

    await ctx.job.backfillActivity.trigger();

    const rows = await ctx.repos.backfills.findMany({});
    expect(rows).toHaveLength(1);
    // Nothing was written: the guard returned before the fold.
    expect(await datasetTotals(ctx)).toEqual(new Map());
  });
});
