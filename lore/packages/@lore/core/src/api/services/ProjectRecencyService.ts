import { $inject, z } from "alepha";
import { audits } from "alepha/api/audits";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";

/**
 * When each project last moved, read once for two readers.
 *
 * `getHomeOverview` carries it so Home paints its list in the right order on
 * the FIRST frame, and `getHomeBoard` carries it so a return to Home picks up
 * what happened since. It used to live on the board alone, and the list
 * painted in `projects.updatedAt` order first, then reshuffled a second later
 * when the board landed: quest, folio and every other write moves the audit
 * log and never touches the project row.
 */
export class ProjectRecencyService {
  auditRows = $repository(audits);
  database = $inject(DatabaseProvider);
  dt = $inject(DateTimeProvider);

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
  public async lastActivity(
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
}
