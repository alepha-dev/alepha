import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { VisitsApi } from "./VisitsApi.ts";

/**
 * A scheduled job, so the app is NOT eligible for scale-to-zero.
 *
 * That is the property being exercised: `$job({ cron })` puts the expression
 * into `crons` in the manifest, and Bay reads it to decide `sleepEligible`. An
 * app whose crons run in-process must never be put to sleep — nothing would run
 * them, and the failure would be silent.
 *
 * The work itself is deliberately trivial. What matters is that the declaration
 * travels into the artifact without anyone writing it down twice.
 */
export class HousekeepingJobs {
  protected readonly log = $logger();
  protected readonly visits = $inject(VisitsApi);

  heartbeat = $job({
    // Every 15 minutes: often enough to be observable within a session, rare
    // enough not to fill the journal.
    cron: "*/15 * * * *",
    handler: async () => {
      const rows = await this.visits.visits.findMany({});
      this.log.info("housekeeping heartbeat", { rows: rows.length });
    },
  });
}
