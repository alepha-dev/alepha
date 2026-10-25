import { $hook } from "alepha";
import type { DateTime } from "alepha/datetime";

import { CronProvider } from "./CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Cloudflare Workers scheduled event.
     *
     * Emitted when a cron trigger fires in Cloudflare Workers.
     */
    "cloudflare:scheduled": {
      cron: string;
      scheduledTime: number;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cloudflare Workers cron provider.
 *
 * This provider handles scheduled events from Cloudflare Workers Cron Triggers.
 * Unlike the Node.js CronProvider, this doesn't use intervals/timeouts - instead,
 * it reacts to scheduled events triggered by Cloudflare.
 *
 * **Usage:**
 * 1. Define scheduled work with `$job({ cron: "0 * * * *", handler: ... })`
 * 2. Build your app with `alepha build` - cron triggers are automatically added to `wrangler.jsonc`
 * 3. Deploy to Cloudflare Workers
 *
 * **How it works:**
 * - During build, all cron expressions registered here are collected
 * - The build generates `wrangler.jsonc` with `triggers.crons` automatically filled
 * - When Cloudflare fires a cron trigger, the `scheduled` handler emits `cloudflare:scheduled`
 * - This provider listens to that event and runs the matching jobs
 *
 * @see https://developers.cloudflare.com/workers/configuration/cron-triggers/
 */
export class WorkerdCronProvider extends CronProvider {
  /**
   * Override to avoid creating AbortController in global scope.
   * Cloudflare Workers doesn't allow this during initialization.
   */
  public override createCronJob(
    name: string,
    expression: string,
    handler: (context: { now: DateTime }) => Promise<void>,
  ): void {
    this.cronJobs.push({
      name,
      cron: this.parseCronJob(name, expression),
      expression,
      handler,
      loop: false,
    });
  }

  /**
   * Handle a scheduled event from Cloudflare Workers.
   */
  protected readonly onScheduledEvent = $hook({
    on: "cloudflare:scheduled",
    handler: async (event) => {
      const now = this.dt.of(event.scheduledTime);

      this.log.info("Received scheduled event", {
        cron: event.cron,
        scheduledTime: now.format(),
      });

      // Find jobs that match this cron expression
      const matchingJobs = this.cronJobs.filter(
        (job) => job.expression === event.cron,
      );

      if (matchingJobs.length === 0) {
        // No exact match - try to find jobs that would fire at this time
        const matchingByTime = this.cronJobs.filter((job) =>
          job.cron.matchDate(now.toDate()),
        );

        if (matchingByTime.length > 0) {
          this.log.debug(
            `No exact cron match for '${event.cron}', found ${matchingByTime.length} jobs matching by time`,
          );
          await this.runJobs(matchingByTime, now);
          return;
        }

        this.log.warn(`No cron jobs found for expression '${event.cron}'`);
        return;
      }

      await this.runJobs(matchingJobs, now);
    },
  });
}
