import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { blights } from "../entities/blights.ts";
import { projects } from "../entities/projects.ts";

/** Fallback Blights retention window when a project sets no `retentionDays`. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Milliseconds in a day — for the retention-cutoff arithmetic. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps the blights inbox from growing without bound.
 *
 * One table now. The legacy `sigil_blights` this also used to sweep no longer
 * exists — the sigil family was dropped and rebuilt — so the second pass, and
 * the sigil lookup that resolved its rows, went with it.
 */
export class BlightJobs {
  protected readonly log = $logger();
  protected readonly projects = $repository(projects);
  protected readonly blights = $repository(blights);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Hourly purge of stale blights.
   *
   * For each project, deletes `blights` rows whose `lastSeenAt` is older than
   * `project.retentionDays ?? 30` days — but ONLY rows with `status = 'open'`.
   * Resolved blights (`status = 'resolved'`) and quest-forwarded blights
   * (`status` starts with `quest:`) are kept indefinitely as an audit trail
   * (see folio #10 §Blights "Auto-purge").
   *
   * Retention is measured in days/weeks so the exact cadence isn't
   * significant; runs on the shared `0 * * * *` slot to keep the Cloudflare
   * cron-trigger count down.
   */
  public readonly purgeStaleBlights = $job({
    cron: "0 * * * *",
    handler: async () => {
      const nowMs = this.dt.nowMillis();
      const allProjects = await this.projects.findMany({});
      let totalDeleted = 0;

      for (const project of allProjects) {
        try {
          const retentionDays = project.retentionDays ?? DEFAULT_RETENTION_DAYS;
          const cutoff = new Date(nowMs - retentionDays * DAY_MS).toISOString();

          // Scoped straight to the project — a blight carries its own
          // `projectId`, so there is no sigil indirection to resolve.
          const purged = await this.blights.deleteMany({
            projectId: { eq: project.id },
            status: { eq: "open" },
            lastSeenAt: { lt: cutoff },
          });
          totalDeleted += purged.length;
        } catch (err) {
          this.log.warn(
            `Blight purge failed for project ${project.id}: ${String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        this.log.info(`Purged ${totalDeleted} stale open blight(s)`);
      }
    },
  });
}
