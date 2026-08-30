import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { ReleaseController } from "../controllers/ReleaseController.ts";

/**
 * Background jobs for releases: currently just auto-close of releases
 * whose `closesAt` deadline has elapsed.
 */
export class ReleaseJobs {
  protected readonly log = $logger();
  protected readonly releaseController = $inject(ReleaseController);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Auto-close any active release whose `closesAt` is in the past.
   * Runs hourly — releases span days/weeks so finer granularity isn't needed
   * (and sharing the `0 * * * *` slot keeps the Cloudflare cron-trigger count
   * down).
   */
  public readonly autoCloseExpiredReleases = $job({
    cron: "0 * * * *",
    handler: async () => {
      const now = this.dt.nowISOString();
      const expired = await this.releaseController.findExpiredReleases(now);
      if (expired.length === 0) return;

      for (const release of expired) {
        try {
          await this.releaseController.finalizeRelease(release);
          this.log.info(
            `Auto-closed release ${release.id} (#${release.number}) — deadline passed`,
          );
        } catch (err) {
          this.log.warn(
            `Auto-close failed for release ${release.id}: ${String(err)}`,
          );
        }
      }
    },
  });
}
