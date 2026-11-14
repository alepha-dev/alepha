import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";

/**
 * Keeps the errors inbox from growing without bound.
 */
export class ProjectErrorJobs {
  /**
   * Milliseconds in a day — for the retention-cutoff arithmetic.
   */
  protected readonly DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * How many project ids one purge statement may carry as bound parameters.
   * See {@link ProjectErrorJobs.chunked} for why there is a bound at all.
   */
  protected readonly PURGE_BATCH_SIZE = 90;

  /**
   * Fallback Errors retention window when a project sets no `retentionDays`.
   */
  protected readonly DEFAULT_RETENTION_DAYS = 30;

  protected readonly log = $logger();
  protected readonly projects = $repository(projects);
  protected readonly projectErrors = $repository(projectErrors);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Hourly purge of stale errors.
   *
   * For each project, deletes `projectErrors` rows whose `lastSeenAt` is older than
   * `project.retentionDays ?? 30` days — but ONLY rows with `status = 'open'`.
   * Resolved errors (`status = 'resolved'`) and quest-forwarded errors
   * (`status` starts with `quest:`) are kept indefinitely as an audit trail
   * (see folio #10 §Errors "Auto-purge").
   *
   * Retention is measured in days/weeks so the exact cadence isn't
   * significant; runs on the shared `0 * * * *` slot to keep the Cloudflare
   * cron-trigger count down.
   *
   * The window is per project but the statement is not: projects are grouped by
   * the window that applies to them, so this issues one `DELETE` per distinct
   * retention value rather than one per project. See {@link byRetention}.
   */
  public readonly purgeStaleProjectErrors = $job({
    name: "errors.purge-stale",
    description:
      "Deletes open errors with no new occurrence within their project's retention window (30 days by default).",
    cron: "0 * * * *",
    // Two minutes. One DELETE per distinct retention window, so the cost
    // grows with the number of windows rather than with the project count,
    // and the hourly trigger it shares measures 39.4 s at p99 wall across
    // all ten of its jobs, almost all of it D1 round-trip wait.
    timeout: [2, "minutes"],
    handler: async () => {
      const nowMs = this.dt.nowMillis();
      const allProjects = await this.projects.findMany({
        columns: ["id", "retentionDays"],
      });
      let totalDeleted = 0;

      for (const [retentionDays, projectIds] of this.byRetention(allProjects)) {
        const cutoff = new Date(
          nowMs - retentionDays * this.DAY_MS,
        ).toISOString();

        for (const chunk of this.chunked(projectIds)) {
          try {
            // Scoped straight to the projects — an error carries its own
            // `projectId`, so there is no sigil indirection to resolve.
            const purged = await this.projectErrors.deleteMany({
              projectId: { inArray: chunk },
              status: { eq: "open" },
              lastSeenAt: { lt: cutoff },
            });
            totalDeleted += purged.length;
          } catch (err) {
            this.log.warn(
              `Error purge failed for ${chunk.length} project(s) at ${retentionDays}d retention: ${String(err)}`,
            );
          }
        }
      }

      if (totalDeleted > 0) {
        this.log.info(`Purged ${totalDeleted} stale open error(s)`);
      }
    },
  });

  /**
   * Project ids bucketed by the retention window that applies to them.
   *
   * The cutoff is the only thing that varied per project, so projects sharing a
   * window share a statement. This used to be one `DELETE` per project issued
   * in a serial loop — against D1 that is one network round-trip each, and
   * production was paying ~27 of them every hour to delete nothing at all
   * (`totalDeleted` is almost always zero). Virtually every project runs on the
   * default window, so in practice this is now one statement.
   *
   * The trade is failure granularity: a statement that throws takes its whole
   * batch with it rather than one project, so the warning names the batch
   * instead of a project id. Retention is measured in days — a batch missed
   * this hour is swept the next — so losing per-project isolation costs a log
   * line's precision, not data.
   */
  protected byRetention(
    projects: Array<{ id: number; retentionDays?: number | null }>,
  ): Map<number, number[]> {
    const groups = new Map<number, number[]>();
    for (const project of projects) {
      const days = project.retentionDays ?? this.DEFAULT_RETENTION_DAYS;
      const ids = groups.get(days);
      if (ids) {
        ids.push(project.id);
      } else {
        groups.set(days, [project.id]);
      }
    }
    return groups;
  }

  /**
   * Splits ids into batches small enough to bind as query parameters.
   *
   * Every id in an `inArray` is one bound parameter, and a statement that
   * exceeds the driver's ceiling fails outright — so an unbounded batch trades
   * this job's old round-trip cost for a cliff it falls off the day the
   * instance gets popular. The bound is deliberately well under any limit worth
   * guessing at: nothing is dropped, the work is simply split, and at today's
   * project count it is a single batch either way.
   */
  protected chunked(ids: number[]): number[][] {
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += this.PURGE_BATCH_SIZE) {
      batches.push(ids.slice(i, i + this.PURGE_BATCH_SIZE));
    }
    return batches;
  }
}
