import { $inject, z } from "alepha";
import { AnalyticsBuckets } from "alepha/api/analytics";
import { audits } from "alepha/api/audits";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  $repository,
  DatabaseProvider,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";

import { analyticsBackfills } from "../entities/analyticsBackfills.ts";
import { LoreAnalytics } from "../entities/loreAnalytics.ts";

/**
 * Fills `project_activity` with the fourteen days of `audits` that predate
 * it, exactly once (#E65).
 *
 * Without this the momentum bars fill in over a fortnight and Home reads as a
 * set of projects that stopped moving. It is possible at all because
 * `AnalyticsPrimitive.recordMany` takes a caller-supplied `hour`: Analytics
 * Engine stamps its own write-time `timestamp` and cannot backdate a point,
 * so the bucket is a carried field rather than the backend's clock.
 *
 * ## ⚠️ One shot, and the guard is a row
 *
 * Analytics Engine has no delete API, so a second pass cannot be undone: it
 * adds to what the first wrote, and every bar reads double from then on,
 * permanently. `analytics_backfills` holds one row per dataset, keyed on the
 * dataset name, and this job returns immediately when it is there. The row is
 * inserted **before** the points are written, not after, so a crash halfway
 * through leaves the dataset short rather than doubled - the only one of the
 * two failures that can be lived with. `retry` is deliberately absent for the
 * same reason, and the primary key settles the race between two isolates
 * reaching the check together.
 *
 * ## ⚠️ It skips the hours the live recording already owns
 *
 * `LoreAuditService` starts writing the moment this code deploys, and this
 * job runs on the hour after. So every `(project, hour)` the dataset already
 * holds a point for is dropped from the fold: without that, the gap between
 * the deploy and the first tick would be counted twice.
 *
 * The consequence, carried knowingly: in the ONE hour the deploy landed in, a
 * project that recorded anything live loses whatever it had recorded before
 * the deploy, because the pair is skipped whole. That is at most a partial
 * hour of one bar, and it is the right side to err on - a bar short by a few
 * events is still a bar, a bar counted twice is a lie with no way back.
 *
 * ## Why a cron and not an endpoint
 *
 * The read is D1 and the write is Analytics Engine, so both ends exist only
 * inside the deployed Worker and no local script can do this. An admin
 * endpoint would need somebody to hold an admin credential and remember to
 * call it exactly once. A cron on the hour needs nobody, and the row is what
 * makes "once" true rather than a promise.
 *
 * `0 * * * *` is an expression four other jobs already use. Cloudflare counts
 * cron triggers per account across every Worker on it, so joining an existing
 * slot costs nothing where a new minute would.
 *
 * **This job is deletable** once its row exists on production, and deleting
 * it is safe: the row stays, and nothing else reads it.
 */
export class ActivityBackfillJob {
  /**
   * The window, in days. The same fourteen `HomeController` draws - there is
   * nothing to gain from backfilling a bar nothing renders, and every extra
   * day is more rows read inside one Worker invocation.
   */
  public static readonly WINDOW_DAYS = 14;

  /**
   * The dataset this fills, and the primary key of its guard row.
   */
  public static readonly DATASET = "project_activity";

  /**
   * How many points go to the backend per call.
   *
   * On Workers each one is a `writeDataPoint`; on a relational backend each
   * batch is a set of upserts. Chunked so neither an isolate's memory nor a
   * single statement's parameter count is asked to hold the whole fold.
   */
  protected static readonly BATCH = 250;

  protected readonly log = $logger();
  protected readonly auditRows = $repository(audits);
  protected readonly backfills = $repository(analyticsBackfills);
  protected readonly datasets = $inject(LoreAnalytics);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly sqlx = $inject(SqlExpressionProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  public readonly backfillActivity = $job({
    name: "analytics.backfill-activity",
    description:
      "Fills project_activity from the audit log, once, then never again.",
    cron: "0 * * * *",
    // Measured against a 13,428-row window folded in the database: the read
    // returns a few thousand tuples and the write is that many data points.
    // Generous because it happens once.
    timeout: [5, "minutes"],
    handler: async () => {
      if (await this.alreadyRan()) {
        return;
      }
      await this.run();
    },
  });

  /**
   * Whether the guard row is there.
   *
   * One primary-key lookup, which is what this job costs on every tick for
   * the rest of the application's life.
   */
  protected async alreadyRan(): Promise<boolean> {
    const [row] = await this.backfills.findMany({
      where: { dataset: { eq: ActivityBackfillJob.DATASET } },
      limit: 1,
    });
    return row !== undefined;
  }

  /**
   * The pass itself.
   */
  protected async run(): Promise<void> {
    const now = this.dateTime.nowMillis();
    const windowFrom = AnalyticsBuckets.hour(
      now - ActivityBackfillJob.WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const windowTo = AnalyticsBuckets.hour(now);

    const tuples = await this.fold();
    const taken = await this.hoursAlreadyRecorded(windowFrom);
    const isTaken = (tuple: ActivityTuple): boolean =>
      taken.has(this.key(tuple.project, tuple.hour));

    const pending = tuples.filter((tuple) => !isTaken(tuple));
    const skipped = new Set(tuples.filter(isTaken).map((tuple) => tuple.hour));
    const events = pending.reduce((total, tuple) => total + tuple.count, 0);

    // ⚠️ The claim comes BEFORE the writes. A crash after this point leaves
    // the dataset short; a crash before it leaves it untouched. No ordering
    // makes a partial write repairable, so the guard goes where it cannot be
    // skipped.
    await this.backfills.create({
      dataset: ActivityBackfillJob.DATASET,
      windowFrom,
      windowTo,
      points: pending.length,
      events,
      skippedHours: skipped.size,
    });

    for (let at = 0; at < pending.length; at += ActivityBackfillJob.BATCH) {
      const batch = pending.slice(at, at + ActivityBackfillJob.BATCH);
      await this.datasets.activity.recordMany(
        batch.map((tuple) => ({
          project: tuple.project,
          type: tuple.type,
          action: tuple.action,
          actor: tuple.actor,
          count: tuple.count,
          hour: tuple.hour,
        })),
      );
    }

    this.log.info("Backfilled project_activity from the audit log", {
      points: pending.length,
      events,
      skippedHours: skipped.size,
      windowFrom,
      windowTo,
    });
  }

  /**
   * Fourteen days of project-scoped audit rows, folded in the database to one
   * row per `(project, type, action, actor, hour)`.
   *
   * ⚠️ `SUM(event_count)`, never `COUNT(*)`. A coalescing audit type folds a
   * burst of identical writes into one row carrying its count, so counting
   * rows would draw twenty minutes of quest edits as a single event - the
   * same trap `HomeController.momentum` documents on the query this feeds,
   * and the reason the live path writes one point per `create()` call.
   *
   * Folded in SQL rather than in the Worker: the window is 13,428 rows on
   * production and a few thousand distinct tuples, and only one of those two
   * numbers is safe to hold in an isolate.
   *
   * ⚠️ `scope_type = 'project'` is the filter, so app-layer rows never reach
   * the dataset. Same decision as `LoreAuditService` makes on the live path,
   * and the two have to agree or the backfilled days and the live ones would
   * be counting different things.
   */
  protected async fold(): Promise<ActivityTuple[]> {
    const table = this.auditRows.table;
    const hour = this.sqlx.dateHour(table.createdAt);

    const rows = await this.database.run(
      sql`
        SELECT
          ${table.scopeId} AS project,
          ${table.type} AS type,
          ${table.action} AS action,
          COALESCE(${table.userId}, '') AS actor,
          ${hour} AS hour,
          SUM(${table.eventCount}) AS n
        FROM ${table}
        WHERE ${table.scopeType} = 'project'
          AND ${table.scopeId} IS NOT NULL
          AND ${table.createdAt} >= ${this.sqlx.ago(
            ActivityBackfillJob.WINDOW_DAYS,
            "days",
          )}
        GROUP BY ${table.scopeId}, ${table.type}, ${table.action}, ${table.userId}, ${hour}
      `,
      z.object({
        project: z.text(),
        type: z.text(),
        action: z.text(),
        actor: z.string(),
        hour: z.string(),
        n: z.coerce.number(),
      }),
    );

    return rows.map((row) => ({
      project: row.project,
      type: row.type,
      action: row.action,
      // The same fallback the live path uses: an audit row with no user is a
      // write with no token behind it.
      actor: row.actor === "" ? "system" : row.actor,
      hour: row.hour,
      count: Number(row.n) || 0,
    }));
  }

  /**
   * Every `(project, hour)` the dataset already holds a point for.
   *
   * Per project rather than per hour, which costs the same query and loses
   * far less: an hour in which one project recorded live and another did not
   * would otherwise drop the second project's pre-deploy events too.
   */
  protected async hoursAlreadyRecorded(
    windowFrom: string,
  ): Promise<Set<string>> {
    const result = await this.datasets.activity.query({
      since: AnalyticsBuckets.day(windowFrom),
      groupBy: ["hour", "project"],
      select: { count: "sum" },
    });

    return new Set(
      result.rows.map((row) => this.key(String(row.project), String(row.hour))),
    );
  }

  /**
   * The `(project, hour)` pair as one comparable string.
   *
   * A pipe, because a project id is digits and an hour bucket is
   * `YYYY-MM-DDTHH`: neither half can contain one, so no pair can collide
   * with another.
   */
  protected key(project: string, hour: string): string {
    return `${project}|${hour}`;
  }
}

/**
 * One folded audit bucket, ready to be recorded as a point.
 */
export interface ActivityTuple {
  project: string;
  type: string;
  action: string;
  actor: string;
  hour: string;
  count: number;
}
