import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";

import { AiConversationService } from "../services/AiConversationService.ts";
import { AiSettings } from "../services/AiSettings.ts";

/**
 * Background work of the assistant module.
 *
 * - `purgeConversations`: daily, deletes conversations (and their messages)
 *   whose last activity is older than `retentionDays`, reading the
 *   parameter at every tick so an edit applies without a restart. Unset
 *   means keep, and the job does nothing.
 *
 * The cron is static because Cloudflare freezes cron triggers at deploy
 * time; the retention window is the knob, and it is runtime-editable.
 */
export class AiJobs {
  protected readonly log = $logger();
  protected readonly settings = $inject(AiSettings);
  protected readonly conversations = $inject(AiConversationService);

  public readonly purgeConversations = $job({
    name: "system.ai.purge-conversations",
    description:
      "Daily sweep deleting AI conversations idle for longer than the api.ai retentionDays.",
    cron: "17 3 * * *",
    timeout: [60, "seconds"],
    handler: async ({ now }) => {
      const days = this.settings.current.retentionDays;
      if (!days) {
        return;
      }
      const cutoff = now.subtract(days, "day").toISOString();
      let total = 0;
      // Bounded batches, so one sweep never holds a long statement on D1.
      for (let batch = 0; batch < 20; batch++) {
        const purged = await this.conversations.purge(cutoff);
        total += purged;
        if (purged === 0) {
          break;
        }
      }
      if (total > 0) {
        this.log.info(
          `AI purge: deleted ${total} conversation(s) idle for more than ${days} days`,
        );
      }
    },
  });
}
