import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { HourlyChecks } from "../services/HourlyChecks.ts";

/**
 * The one hourly job (#Q3893), on `0 * * * *`, an expression the Worker
 * already runs (`EpicJobs`, `ProjectErrorJobs`, `SigilJobs`): no trigger is
 * added. Each registered check runs in turn; overlapping ticks are covered
 * by the job's cron claim and by each check's own conditional writes.
 */
export class HourlyJobs {
  protected readonly checks = $inject(HourlyChecks);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  public readonly hourly = $job({
    name: "project-events.hourly",
    description:
      "Runs the hourly checks: quest reminders, the open-errors threshold and scheduled agent automations.",
    cron: "0 * * * *",
    handler: async () => {
      const now = this.dateTime.nowISOString();
      for (const check of this.checks.all()) {
        try {
          await check.run(now);
        } catch (error) {
          this.log.error("Hourly check failed", { check: check.name, error });
        }
      }
    },
  });
}
