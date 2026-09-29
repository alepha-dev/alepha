import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { EpicWorkflowService } from "../services/EpicWorkflowService.ts";

export class EpicJobs {
  protected readonly log = $logger();
  protected readonly workflow = $inject(EpicWorkflowService);

  /**
   * Finish the epic transitions a failed write left undone (#Q2547).
   *
   * An epic moves when a quest's own write has landed: the first accept
   * starts it, the last completion or shelve completes it. Lore runs on D1,
   * where the two writes cannot share a transaction, so the epic's can fail
   * after the quest's succeeded, and nothing retries it: the quest action is
   * already done. See `EpicWorkflowService.sweep` for what is healed.
   *
   * ⚠️ Hourly on `0 * * * *`, the expression Lore's other jobs already use,
   * so it adds no Cloudflare cron trigger (#F1325).
   */
  public readonly sweep = $job({
    name: "epics.sweep-transitions",
    description:
      "Completes in-progress epics with no open quest, and starts ready epics that already hold an accepted quest, hourly.",
    cron: "0 * * * *",
    timeout: [2, "minutes"],
    handler: async () => {
      const { started, completed } = await this.workflow.sweep();
      if (started + completed > 0) {
        this.log.info("Epic transitions healed", { started, completed });
      }
    },
  });
}
