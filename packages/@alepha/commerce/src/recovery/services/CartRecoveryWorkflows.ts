import { $inject, $store, z } from "alepha";
import { $workflow } from "alepha/api/workflows";

import { cartRecoveryConfig } from "../cartRecoveryConfigAtom.ts";
import { CartRecoveryService } from "./CartRecoveryService.ts";

/**
 * The abandoned-cart sequence as one durable workflow per cart:
 * wait → remind → wait → remind again → wait → mark abandoned.
 *
 * Every wait is a step-level `delay`, persisted by the engine — a
 * redeploy mid-sequence loses nothing. Every step re-checks
 * `isRecoverable` in its `when()`: the moment the checkout converts (or
 * the email disappears), the remaining steps skip and the execution
 * completes quietly. A conversion also cancels the execution outright
 * via `CartRecoveryListener`, which is faster and reads better in the
 * admin — the `when()` guards are the safety net, not the primary path.
 *
 * `onError: "fail"` — there is nothing to compensate; a permanently
 * failing mail shows up as a failed execution to retry from the admin.
 */
export class CartRecoveryWorkflows {
  protected readonly config = $store(cartRecoveryConfig);
  protected readonly recovery = $inject(CartRecoveryService);

  public readonly cartRecovery = $workflow({
    schema: z.object({ cartId: z.uuid() }),
    tags: ["commerce", "recovery"],
    onError: "fail",
    steps: [
      {
        name: "firstReminder",
        delay: [this.config.firstReminderAfterMinutes, "minute"],
        when: ({ payload }) => this.recovery.isRecoverable(payload.cartId),
        retry: { retries: 3, backoff: { initial: [1, "minute"], factor: 4 } },
        handler: async ({ payload }) => {
          const sent = await this.recovery.sendReminder(payload.cartId, 1);
          return { sent };
        },
      },
      {
        name: "secondReminder",
        delay: [this.config.secondReminderAfterMinutes, "minute"],
        when: ({ payload }) => this.recovery.isRecoverable(payload.cartId),
        retry: { retries: 3, backoff: { initial: [1, "minute"], factor: 4 } },
        handler: async ({ payload }) => {
          const sent = await this.recovery.sendReminder(payload.cartId, 2);
          return { sent };
        },
      },
      {
        name: "markAbandoned",
        delay: [this.config.abandonAfterMinutes, "minute"],
        when: ({ payload }) => this.recovery.isRecoverable(payload.cartId),
        retry: { retries: 3, backoff: { initial: [1, "minute"], factor: 4 } },
        handler: async ({ payload }) => {
          await this.recovery.markAbandoned(payload.cartId);
          return { abandoned: true };
        },
      },
    ],
  });
}
