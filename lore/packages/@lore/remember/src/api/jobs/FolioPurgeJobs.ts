import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { FolioRecentlyDeleted } from "../services/FolioRecentlyDeleted.ts";

/**
 * The nightly purge of deleted folios (#Q3698): what was deleted more than
 * 30 days ago goes for good. It replaced the Trash directory's sweep
 * (#Q3659), at the same hour.
 */
export class FolioPurgeJobs {
  protected readonly recentlyDeleted = $inject(FolioRecentlyDeleted);

  public readonly purgeDeleted = $job({
    name: "folios.purge-deleted",
    description:
      "Deletes for good the folios deleted more than 30 days ago, with their files and history.",
    cron: "30 3 * * *",
    timeout: [5, "minutes"],
    retry: { retries: 2 },
    handler: async () => {
      await this.recentlyDeleted.purge();
    },
  });
}
