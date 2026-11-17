import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";

import { RequirementsCoverageSnapshot } from "../services/RequirementsCoverageSnapshot.ts";

/**
 * The daily coverage snapshot (#E153, #Q3775) the Coverage over time card
 * reads. History starts the day Plan's `requirements` option is on.
 *
 * ⚠️ At midnight on `0 0 * * *`, the expression Lore's nightly jobs already
 * share, so it adds no Cloudflare cron trigger (#F1325): it records the day
 * that just ended.
 */
export class RequirementsCoverageJobs {
  protected readonly snapshots = $inject(RequirementsCoverageSnapshot);
  protected readonly dt = $inject(DateTimeProvider);

  public readonly snapshot = $job({
    name: "requirements.coverage-snapshot",
    description: "Records each project's requirement coverage for the day.",
    cron: "0 0 * * *",
    lock: true,
    timeout: [5, "minutes"],
    handler: async () => {
      const day = this.dt.now().subtract(1, "day").toISOString().slice(0, 10);
      await this.snapshots.snapshot(undefined, day);
    },
  });
}
