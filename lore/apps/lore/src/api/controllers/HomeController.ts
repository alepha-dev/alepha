import { $inject, z } from "alepha";
import { audits } from "alepha/api/audits";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DatabaseProvider,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { blights } from "../entities/blights.ts";
import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { relations } from "../relations.ts";

/**
 * Home's own data: the momentum bars beside each project, when each project
 * last moved, and what is open in it.
 *
 * ## Why it is not on `getHomeOverview`
 *
 * That endpoint fills `userProjectsAtom`, which every page holds: the project
 * switcher, Spotlight, the account area. Home is one page, and an aggregate
 * over the audit log on every route change is a cost the other readers of
 * that atom never asked for. This action is the home page's, fetched when it
 * mounts and on an explicit refresh.
 *
 * ## No polling
 *
 * `DataTable` fetches on mount and on refresh, and nothing here is on an
 * interval. The QuestGraph incident (folio #1057) was a loader revalidating
 * once per second for 51 minutes: 4,009 identical requests from one tab,
 * roughly 35% of that day's account-wide Worker invocations. The landing page
 * is the worst place to reintroduce it.
 */
export class HomeController {
  /**
   * How many days of bars the Momentum column draws.
   *
   * Fourteen is two weeks, which is what makes a weekly rhythm visible: a
   * seven-day window shows one of every weekend dip and cannot tell a quiet
   * week from a quiet fortnight.
   */
  protected static readonly MOMENTUM_DAYS = 14;

  auditRows = $repository(audits);
  epicRows = $repository(epics);
  blightRows = $repository(blights);
  feedbackRows = $repository(feedback);
  usersWith = $repository(relations, "users");
  database = $inject(DatabaseProvider);
  sqlx = $inject(SqlExpressionProvider);
  dt = $inject(DateTimeProvider);

  /**
   * Everything Home draws that `getHomeOverview` does not already carry.
   *
   * One action rather than two, because the page needs both before it is
   * worth looking at and both are answered from the same membership read.
   */
  getHomeBoard = $action({
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      response: z.object({
        /**
         * The days the momentum counts are indexed by, oldest first, as
         * `YYYY-MM-DD`. Sent rather than derived on the client so the bars
         * cannot drift from the buckets the database grouped: both ends
         * would otherwise decide what "today" means, in two timezones.
         */
        days: z.array(z.text()),
        momentum: z.array(
          z.object({
            projectId: z.integer(),
            /**
             * One number per entry of {@link days}, same order, zero-filled.
             */
            counts: z.array(z.integer()),
          }),
        ),
        /**
         * When each project last saw any activity, whatever its kind: the
         * table's Last activity column. One entry per project.
         */
        lastActivity: z.array(
          z.object({
            projectId: z.integer(),
            at: z.datetime(),
          }),
        ),
        /**
         * What is open in each project beyond its quests, for the table's
         * Open column: draft epics, open blights, pending feedback. The
         * quest count is already on the overview (`openQuestCount`). One
         * entry per project, zeros included.
         */
        openCounts: z.array(
          z.object({
            projectId: z.integer(),
            epics: z.integer(),
            blights: z.integer(),
            feedback: z.integer(),
          }),
        ),
      }),
    },
    handler: async ({ user }) => {
      const days = this.momentumDays();
      const projects = await this.memberProjects(user.id);

      // ⚠️ Short-circuited on an empty membership list: `inArray: []` THROWS
      // rather than matching nothing, and a brand-new account is exactly the
      // request that hits it.
      if (projects.length === 0) {
        return {
          days,
          momentum: [],
          lastActivity: [],
          openCounts: [],
        };
      }

      const [momentum, lastActivity, openCounts] = await Promise.all([
        this.momentum(
          projects.map((project) => String(project.id)),
          days,
        ),
        this.lastActivity(projects),
        this.openCounts(projects.map((project) => project.id)),
      ]);

      return { days, momentum, lastActivity, openCounts };
    },
  });

  /**
   * The projects the viewer belongs to, most recently updated first.
   */
  protected async memberProjects(
    userId: string,
  ): Promise<Array<{ id: number; title: string; updatedAt: string }>> {
    const me = await this.usersWith.findById(userId, {
      include: {
        projects: {
          orderBy: { column: "updatedAt", direction: "desc" },
        },
      },
    });
    return me?.projects ?? [];
  }

  /**
   * When each project last saw any activity: its newest audit event, whatever
   * its kind, or the project row's own `updatedAt` when that is later (and
   * for a project with no events at all).
   *
   * ## One statement, one index seek per project
   *
   * A correlated subquery per project, over a `VALUES` list of their ids,
   * rather than `MAX(createdAt) ... GROUP BY scopeId`. The grouped form reads
   * every event of every project on each Home load, so it grows with the
   * audit log; this one walks `(scopeType, scopeId, createdAt)` backwards and
   * stops at the first row, so it grows with the number of projects only.
   * `VALUES` names its column `column1` in both SQLite and Postgres.
   *
   * `COALESCE(updatedAt, createdAt)` because a coalesced burst starts at
   * `createdAt` and ends at `updatedAt`. Taken from the burst that STARTED
   * last, which can miss a longer burst that started earlier by at most its
   * window (5 minutes in Lore): invisible at the column's "3 days ago"
   * precision, and the price of reading one row instead of all of them.
   */
  protected async lastActivity(
    projects: Array<{ id: number; updatedAt: string }>,
  ): Promise<Array<{ projectId: number; at: string }>> {
    const table = this.auditRows.table;
    const rows = await this.database.run(
      sql`
        SELECT
          v.column1 AS scope_id,
          (
            SELECT COALESCE(${table.updatedAt}, ${table.createdAt})
            FROM ${table}
            WHERE ${table.scopeType} = 'project'
              AND ${table.scopeId} = v.column1
            ORDER BY ${table.createdAt} DESC
            LIMIT 1
          ) AS last_at
        FROM (VALUES ${sql.join(
          projects.map((project) => sql`(${String(project.id)})`),
          sql`, `,
        )}) AS v
      `,
      z.object({
        scope_id: z.text(),
        // Integer milliseconds on SQLite, a timestamp on Postgres, and null
        // for a project with no events. `dt.of` reads every one of them, so
        // the column is decoded as whatever the driver returned.
        last_at: z.any(),
      }),
    );

    const lastEvent = new Map(
      rows
        .filter((row) => row.last_at != null)
        .map((row) => [
          Number(row.scope_id),
          this.dt.of(row.last_at as number | string | Date).valueOf(),
        ]),
    );

    return projects.map((project) => {
      const own = this.dt.of(project.updatedAt).valueOf();
      const event = lastEvent.get(project.id) ?? 0;
      return {
        projectId: project.id,
        at: this.dt.of(Math.max(own, event)).toISOString(),
      };
    });
  }

  /**
   * Draft epics, open blights and pending feedback per project, in ONE
   * statement for every project at once.
   *
   * Each count is what the project's sidebar badge counts, so the two never
   * disagree: `draft` epics only (the quests of a ready or in-progress epic
   * are already in the quest count), `open` blights, `pending` feedback.
   *
   * The id list is bound once, as a `VALUES` table the three branches read,
   * rather than as an `IN (...)` per branch: D1 caps a statement at 100
   * bound parameters, and three copies of the list would reach it at 34
   * projects. `CAST` because a bare `VALUES` parameter has no type of its
   * own to compare against an integer column.
   *
   * Raw SQL, so the soft delete the repositories apply is spelled out:
   * epics and feedback carry `deletedAt`, blights do not.
   */
  protected async openCounts(projectIds: number[]): Promise<
    Array<{
      projectId: number;
      epics: number;
      blights: number;
      feedback: number;
    }>
  > {
    const e = this.epicRows.table;
    const b = this.blightRows.table;
    const f = this.feedbackRows.table;
    const rows = await this.database.run(
      sql`
        WITH ids(id) AS (VALUES ${sql.join(
          projectIds.map((id) => sql`(CAST(${id} AS INTEGER))`),
          sql`, `,
        )})
        SELECT 'epics' AS kind, ${e.projectId} AS project_id, COUNT(*) AS n
        FROM ${e}
        WHERE ${e.projectId} IN (SELECT id FROM ids)
          AND ${e.status} = 'draft'
          AND ${e.deletedAt} IS NULL
        GROUP BY ${e.projectId}
        UNION ALL
        SELECT 'blights' AS kind, ${b.projectId} AS project_id, COUNT(*) AS n
        FROM ${b}
        WHERE ${b.projectId} IN (SELECT id FROM ids)
          AND ${b.status} = 'open'
        GROUP BY ${b.projectId}
        UNION ALL
        SELECT 'feedback' AS kind, ${f.projectId} AS project_id, COUNT(*) AS n
        FROM ${f}
        WHERE ${f.projectId} IN (SELECT id FROM ids)
          AND ${f.status} = 'pending'
          AND ${f.deletedAt} IS NULL
        GROUP BY ${f.projectId}
      `,
      z.object({
        kind: z.enum(["epics", "blights", "feedback"]),
        project_id: z.coerce.number(),
        n: z.coerce.number(),
      }),
    );

    const byProject = new Map(
      projectIds.map((projectId) => [
        projectId,
        { projectId, epics: 0, blights: 0, feedback: 0 },
      ]),
    );
    for (const row of rows) {
      const counts = byProject.get(row.project_id);
      if (counts) {
        counts[row.kind] = row.n;
      }
    }
    return [...byProject.values()];
  }

  /**
   * The bars, in one grouped statement for every project at once.
   *
   * `SUM(eventCount)` rather than `COUNT(*)`: `$audit`'s `coalesce` folds a
   * burst of identical writes into one row carrying its count, so counting
   * rows would draw twenty minutes of quest edits as a single event and make
   * the busiest projects read as the quietest.
   */
  protected async momentum(
    scopeIds: string[],
    days: string[],
  ): Promise<Array<{ projectId: number; counts: number[] }>> {
    const table = this.auditRows.table;
    const day = this.sqlx.dateDay(table.createdAt);

    const rows = await this.database.run(
      sql`
        SELECT
          ${table.scopeId} AS scope_id,
          ${day} AS day,
          SUM(${table.eventCount}) AS n
        FROM ${table}
        WHERE ${table.scopeType} = 'project'
          AND ${table.scopeId} IN (${sql.join(
            scopeIds.map((id) => sql`${id}`),
            sql`, `,
          )})
          AND ${table.createdAt} >= ${this.sqlx.ago(
            HomeController.MOMENTUM_DAYS,
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

    const index = new Map(days.map((label, position) => [label, position]));
    const byProject = new Map<number, number[]>(
      scopeIds.map((id) => [Number(id), days.map(() => 0)]),
    );
    for (const row of rows) {
      const counts = byProject.get(Number(row.scope_id));
      const position = index.get(row.day);
      // A row outside the labels is a boundary case, not an error: `ago()` is
      // instant-aligned while the labels are calendar days, so the oldest
      // bucket of the query can be the day before the oldest label.
      if (counts && position !== undefined) {
        counts[position] = Number(row.n) || 0;
      }
    }

    return [...byProject].map(([projectId, counts]) => ({
      projectId,
      counts,
    }));
  }

  /**
   * The window's day labels, oldest first, in UTC.
   *
   * UTC because `SqlExpressionProvider.dateDay` buckets in UTC on both
   * dialects, and a label generated in another zone would name a bucket the
   * database never produced. The read is through `DateTimeProvider`, so a
   * test that travels sees the window move with it.
   */
  protected momentumDays(): string[] {
    const today = this.dt.nowMillis();
    const dayMs = 24 * 60 * 60 * 1000;
    const labels: string[] = [];
    for (let back = HomeController.MOMENTUM_DAYS - 1; back >= 0; back--) {
      labels.push(new Date(today - back * dayMs).toISOString().slice(0, 10));
    }
    return labels;
  }
}
