import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { AppUsageService } from "../services/AppUsageService.ts";

/**
 * Keeps the supervisor series going.
 *
 * A minute, because that is the resolution at which a memory climb is still
 * legible — an app that gets OOM-killed usually spends several minutes getting
 * there, and a five-minute sample can miss the whole climb and show only the
 * gap afterwards. Finer than a minute buys detail nobody reads and costs rows
 * forever.
 */
export class AppUsageJobs {
  protected readonly log = $logger();
  protected readonly usage = $inject(AppUsageService);

  sampleUsage = $job({
    name: "bay-admin:usage:sample",
    cron: "* * * * *",
    handler: async () => {
      try {
        await this.usage.sample();
      } catch (error) {
        // Warn, not error, and swallowed: Bay being briefly unreachable — it
        // is restarted on every upgrade — is a gap in a chart, not an incident.
        // Letting this throw would put a stack trace in the log every minute
        // for the length of a Bay restart.
        this.log.warn("could not sample app usage", { error });
      }
    },
  });

  /**
   * Prunes daily, at an hour nobody deploys.
   *
   * Separate from the sampler so a failure to delete never costs a sample: the
   * series is the point, and the disk has fourteen days of slack.
   */
  pruneUsage = $job({
    name: "bay-admin:usage:prune",
    cron: "17 4 * * *",
    handler: async () => {
      const deleted = await this.usage.prune();
      if (deleted) {
        this.log.info("pruned old usage samples", { deleted });
      }
    },
  });
}
