import { $inject, $store, z } from "alepha";
import { $job } from "alepha/api/jobs";

import { cartRecoveryConfig } from "../cartRecoveryConfigAtom.ts";
import { CartRecoveryService } from "./CartRecoveryService.ts";

/**
 * The abandoned-cart sequence as one durable job per cart:
 * wait, remind, wait, remind again, wait, mark abandoned.
 *
 * Every wait is a `reschedule` of the same execution row, persisted before
 * any timer is armed: a redeploy mid-sequence loses nothing. Every stage
 * first re-checks `isRecoverable`: the moment the checkout converts (or the
 * email disappears), the sequence ends quietly. A conversion also cancels
 * the parked row outright via `CartRecoveryListener`, which is faster and
 * reads better in the admin; the re-check is the safety net for a row that
 * was mid-stage when the order paid.
 *
 * There is nothing to compensate; a permanently failing mail shows up as an
 * `error` row on the admin jobs page, to retry from there.
 */
export class CartRecoveryJobs {
  protected readonly config = $store(cartRecoveryConfig);
  protected readonly recovery = $inject(CartRecoveryService);

  public readonly cartRecovery = $job({
    description:
      "Two reminders and an abandoned mark for a cart whose checkout captured an email.",
    schema: z.object({
      cartId: z.uuid(),
      stage: z
        .enum(["firstReminder", "secondReminder", "markAbandoned"])
        .optional(),
    }),
    record: "all",
    retry: {
      retries: 3,
      backoff: { initial: [1, "minute"], factor: 4 },
    },
    handler: async ({ payload, reschedule }) => {
      if (!(await this.recovery.isRecoverable(payload.cartId))) {
        return;
      }
      switch (payload.stage ?? "firstReminder") {
        case "firstReminder":
          await this.recovery.sendReminder(payload.cartId, 1);
          reschedule({
            delay: [this.config.secondReminderAfterMinutes, "minute"],
            payload: { ...payload, stage: "secondReminder" },
          });
          return;
        case "secondReminder":
          await this.recovery.sendReminder(payload.cartId, 2);
          reschedule({
            delay: [this.config.abandonAfterMinutes, "minute"],
            payload: { ...payload, stage: "markAbandoned" },
          });
          return;
        case "markAbandoned":
          await this.recovery.markAbandoned(payload.cartId);
          return;
      }
    },
  });
}
