import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { GitHubAppService } from "../services/GitHubAppService.ts";
import { GitHubDeliveryService } from "../services/GitHubDeliveryService.ts";

/**
 * The GitHub deliveries' two schedules (#Q4364), on crons the Worker already
 * has (Cloudflare counts cron triggers per account).
 */
export class GitHubDeliveryJobs {
  protected readonly log = $logger();
  protected readonly deliveries = $inject(GitHubDeliveryService);
  protected readonly apps = $inject(GitHubAppService);

  /**
   * Every five minutes: what the deferred handling left, and the prune.
   * Cheap when nothing is due: one indexed read.
   */
  public readonly sweepGitHubDeliveries = $job({
    name: "github.sweep-deliveries",
    description:
      "Retries GitHub deliveries left pending or failed, and prunes those past seven days.",
    cron: "*/5 * * * *",
    timeout: [2, "minutes"],
    handler: async () => {
      const { handled, pruned } = await this.deliveries.sweep();
      if (handled > 0 || pruned > 0) {
        this.log.info("GitHub deliveries swept", { handled, pruned });
      }
    },
  });

  /**
   * Hourly: asks GitHub to redeliver what Lore never stored. Skipped on an
   * instance with no App.
   */
  public readonly redeliverGitHubDeliveries = $job({
    name: "github.redeliver-deliveries",
    description:
      "Asks GitHub to redeliver the App's recent deliveries that Lore never stored.",
    cron: "0 * * * *",
    timeout: [2, "minutes"],
    handler: async () => {
      if (!(await this.apps.credentials())) return;
      const asked = await this.deliveries.redeliver();
      if (asked > 0) this.log.info("GitHub redeliveries asked", { asked });
    },
  });
}
