import { $hook, $inject, $store } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { checkoutSessions } from "../../checkout/entities/checkoutSessions.ts";
import { cartRecoveryConfig } from "../cartRecoveryConfigAtom.ts";
import { CartRecoveryJobs } from "./CartRecoveryJobs.ts";

/**
 * Starts the recovery sequence when a checkout captures an email, and
 * cancels it the moment the order pays.
 *
 * The push is idempotent (`key` = cart id): a buyer correcting their email
 * mid-checkout re-fires the event and lands on the same execution.
 */
export class CartRecoveryListener {
  protected readonly log = $logger();
  protected readonly jobs = $inject(CartRecoveryJobs);
  protected readonly config = $store(cartRecoveryConfig);
  protected readonly sessions = $repository(checkoutSessions);

  protected readonly onCheckoutEmail = $hook({
    on: "commerce:checkout:email",
    handler: async (event) => {
      const executionId = await this.jobs.cartRecovery.push(
        { cartId: event.cartId },
        {
          key: event.cartId,
          delay: [this.config.firstReminderAfterMinutes, "minute"],
        },
      );
      this.log.debug("Cart recovery sequence started", {
        cartId: event.cartId,
        executionId,
      });
    },
  });

  protected readonly onOrderPaid = $hook({
    on: "commerce:order:paid",
    handler: async (event) => {
      const session = await this.sessions.findOne({
        where: { orderId: { eq: event.orderId } },
      });
      if (!session) {
        return;
      }

      // The stage re-check would skip the rest anyway; the cancel just ends
      // the parked row now and says why in the admin.
      const cancelled = await this.jobs.cartRecovery.cancelByKey(
        session.cartId,
        { cancelledBy: "system", cancelledByName: "checkout converted" },
      );
      if (cancelled) {
        this.log.debug("Cart recovery sequence cancelled, cart converted", {
          cartId: session.cartId,
          executionId: cancelled,
        });
      }
    },
  });
}
