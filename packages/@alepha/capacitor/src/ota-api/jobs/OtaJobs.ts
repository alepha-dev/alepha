import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { OtaRetention } from "../services/OtaRetention.ts";

/**
 * The nightly upkeep of live updates.
 */
export class OtaJobs {
  protected readonly retention = $inject(OtaRetention);

  /**
   * Delete artifacts past retention, abandon stale uploads, remove orphaned
   * artifacts. See {@link OtaRetention}.
   */
  public readonly retain = $job({
    name: "system.ota.retention",
    cron: "30 3 * * *",
    description: "Deletes live update artifacts past their retention window.",
    timeout: [5, "minutes"],
    handler: async () => {
      await this.retention.run();
    },
  });
}
