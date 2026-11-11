import { $inject, $store, z } from "alepha";
import { $job } from "alepha/api/jobs";

import { cartRecoveryConfig } from "../cartRecoveryConfigAtom.ts";
import { CartRecoveryService } from "./CartRecoveryService.ts";

/**
 * The abandoned-cart sequence as one durable job per cart:
 * wait, remind, wait, remind again, wait, mark abandoned.
 *
 * Each reminder is a step and each wait a `step.sleep` on the same
 * execution row, persisted before any timer is armed: a redeploy
 * mid-sequence loses nothing, and a reminder already sent is never sent
 * again by a later pass. The handler runs from the top after every wake, so
 * the `isRecoverable` check at the top is asked again before each stage:
 * the moment the checkout converts (or the email disappears), the sequence
 * ends quietly. A conversion also cancels the sleeping row outright via
 * `CartRecoveryListener`, which is faster and reads better in the admin;
 * the re-check is the safety net for a row that was mid-stage when the
 * order paid.
 *
 * There is nothing to compensate. A permanently failing mail shows up as an
 * `error` row on the admin jobs page; Retry there resumes at the step that
 * failed, without sending again a reminder that went out or serving again a
 * wait that was served.
 */
export class CartRecoveryJobs {
  protected readonly config = $store(cartRecoveryConfig);
  protected readonly recovery = $inject(CartRecoveryService);

  public readonly cartRecovery = $job({
    name: "system.commerce.recover-cart",
    description:
      "Sends up to two reminders for an abandoned cart with a known email, then marks it abandoned.",
    schema: z.object({ cartId: z.uuid() }),
    // Per-order work: the last N rows keep the last N orders whatever the
    // volume, so the unit is days. Declared, so no row cap applies.
    retention: { ok: { days: 30 }, error: { days: 90 } },
    retry: {
      retries: 3,
      backoff: { initial: [1, "minute"], factor: 4 },
    },
    timeout: [30, "seconds"],
    handler: async ({ payload, step }) => {
      // Outside any step on purpose: the handler runs again from the top
      // after every wake, so this is asked again before each stage.
      if (!(await this.recovery.isRecoverable(payload.cartId))) return;
      await step.run("first-reminder", () =>
        this.recovery.sendReminder(payload.cartId, 1),
      );
      await step.sleep("until-second", [
        this.config.secondReminderAfterMinutes,
        "minute",
      ]);
      await step.run("second-reminder", () =>
        this.recovery.sendReminder(payload.cartId, 2),
      );
      await step.sleep("until-abandon", [
        this.config.abandonAfterMinutes,
        "minute",
      ]);
      await step.run("mark-abandoned", () =>
        this.recovery.markAbandoned(payload.cartId),
      );
    },
  });
}
