import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { LoreForwardService } from "../services/LoreForwardService.ts";

/**
 * Moves error groups toward Lore on a schedule.
 *
 * Two steps on purpose, in one job. `collect` decides what has changed and
 * writes it down; `drain` tries to deliver. Splitting them is what makes a Lore
 * outage cheap — collection keeps working, and the batches simply queue.
 *
 * Five minutes, because the inbox is for triage rather than alerting. Anything
 * needing a faster reaction than that wants a pager, which is a different
 * product and deliberately not this one.
 */
export class ForwardJobs {
  protected readonly log = $logger();
  protected readonly forward = $inject(LoreForwardService);

  forwardToLore = $job({
    name: "pulse:lore:forward",
    cron: "*/5 * * * *",
    handler: async () => {
      const queued = await this.forward.collect();
      const { sent, failed } = await this.forward.drain();

      // Logged only when something happened: a line every five minutes saying
      // "nothing to do" is a line nobody reads, in a log where the one that
      // matters then goes unnoticed.
      if (queued || sent || failed) {
        this.log.info("Forwarded error groups to Lore", {
          queued,
          sent,
          failed,
        });
      }
    },
  });
}
