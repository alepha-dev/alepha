import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { MilestoneController } from "../controllers/MilestoneController.ts";

/**
 * Background jobs for milestones: currently just auto-close of milestones
 * whose `closesAt` deadline has elapsed.
 */
export class MilestoneJobs {
  protected readonly log = $logger();
  protected readonly milestoneController = $inject(MilestoneController);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Auto-close any active milestone whose `closesAt` is in the past.
   * Runs hourly — milestones span days/weeks so finer granularity isn't needed
   * (and sharing the `0 * * * *` slot keeps the Cloudflare cron-trigger count
   * down).
   */
  public readonly autoCloseExpiredMilestones = $job({
    cron: "0 * * * *",
    handler: async () => {
      const now = this.dt.nowISOString();
      const expired = await this.milestoneController.findExpiredMilestones(now);
      if (expired.length === 0) return;

      for (const milestone of expired) {
        try {
          await this.milestoneController.finalizeMilestone(milestone);
          this.log.info(
            `Auto-closed milestone ${milestone.id} (#${milestone.number}) — deadline passed`,
          );
        } catch (err) {
          this.log.warn(
            `Auto-close failed for milestone ${milestone.id}: ${String(err)}`,
          );
        }
      }
    },
  });
}
