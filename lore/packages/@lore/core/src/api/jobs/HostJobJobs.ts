import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { HostJobService } from "../services/HostJobService.ts";

/**
 * The host job queue's quarter-hour pass (#Q3984): a host with a queued job
 * and nothing running is dispatched, so a lost ack never strands a queue.
 * On the cadence the command sweep already uses: a shared cron trigger is
 * free on Cloudflare, a new one is not.
 */
export class HostJobJobs {
  protected readonly jobs = $inject(HostJobService);

  public readonly sweepHostJobs = $job({
    name: "hosts.sweep-jobs",
    description:
      "Dispatches every host's next queued job, so a lost ack never strands a queue.",
    cron: "*/15 * * * *",
    timeout: [60, "seconds"],
    handler: async () => {
      await this.jobs.sweep();
    },
  });
}
