import { $inject, z } from "alepha";
import { audits } from "alepha/api/audits";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DatabaseProvider,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

// The helper the UI labels a user with, so an actor reads identically here,
// in a project's Activity table and on the quest page. Precedent for reaching
// across: `ProjectController` imports the same function.
import { displayName } from "../../web/app/services/displayName.ts";
import { relations } from "../relations.ts";
import { homeActivityRowSchema } from "../schemas/homeActivityRowSchema.ts";

/**
 * Home's own data: the momentum bars beside each project, and the activity
 * panel that runs down the side of the page.
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

  /**
   * How many lines the activity panel holds.
   *
   * Hovering a row filters the panel client-side, so this number is also the
   * depth of that filtered view: at thirty, a project with two of the last
   * thirty events shows two lines rather than an empty panel.
   */
  protected static readonly ACTIVITY_LIMIT = 30;

  auditRows = $repository(audits);
  users = $repository(users);
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
        activity: z.array(homeActivityRowSchema),
      }),
    },
    handler: async ({ user }) => {
      const days = this.momentumDays();

      const me = await this.usersWith.findById(user.id, {
        include: {
          projects: {
            orderBy: { column: "updatedAt", direction: "desc" },
          },
        },
      });
      const projects = me?.projects ?? [];

      // ⚠️ Short-circuited on an empty membership list: `inArray: []` THROWS
      // rather than matching nothing, and a brand-new account is exactly the
      // request that hits it.
      if (projects.length === 0) {
        return { days, momentum: [], activity: [] };
      }

      const scopeIds = projects.map((project) => String(project.id));
      const titles = new Map(
        projects.map((project) => [project.id, project.title]),
      );

      const [momentum, rows] = await Promise.all([
        this.momentum(scopeIds, days),
        this.auditRows.findMany({
          where: {
            scopeType: "project",
            scopeId: { inArray: scopeIds },
          },
          orderBy: { column: "createdAt", direction: "desc" },
          limit: HomeController.ACTIVITY_LIMIT,
        }),
      ]);

      // One lookup for the whole panel, and only when something needs a name.
      // The actors span projects, so this cannot go through a project's member
      // list the way `getProjectActivity` does.
      const actorIds = [
        ...new Set(rows.map((row) => row.userId).filter(Boolean)),
      ] as string[];
      const people = actorIds.length
        ? await this.users.findMany({ where: { id: { inArray: actorIds } } })
        : [];

      return {
        days,
        momentum,
        activity: rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          type: row.type,
          action: row.action,
          userId: row.userId,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          description: row.description,
          // Defaulted rather than passed through: rows written before the
          // column existed read as null, and every consumer would need the
          // same guard.
          eventCount: row.eventCount ?? 1,
          projectId: Number(row.scopeId),
          projectTitle: titles.get(Number(row.scopeId)) ?? "",
          actor: row.userId
            ? displayName(
                people.find((person) => person.id === row.userId),
                row.userId,
              )
            : undefined,
          isMe: row.userId === user.id,
        })),
      };
    },
  });

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
