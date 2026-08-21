import { $hook, $inject } from "alepha";
import { $email } from "alepha/email";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { checkoutSessions } from "../../checkout/entities/checkoutSessions.ts";
import { OrderService } from "../../services/OrderService.ts";
import { OrderMailRenderer } from "../providers/OrderMailRenderer.ts";

/**
 * Sends the two emails a buyer expects: "we got your order" and "it's on its
 * way".
 *
 * The shipping notice is event-driven (`commerce:order:shipped`). The
 * confirmation is NOT: it is a step of the settlement workflow
 * (`@alepha/commerce/settlement`), which calls `sendConfirmationFor` with
 * per-step retry instead of the swallowed-error hook that used to live
 * here — an SMTP outage now means a visible, retryable execution rather
 * than a silently lost email. Import the settlement module to send
 * confirmations at all.
 *
 * The recipient comes from the checkout session rather than the order: an order
 * has no email column, because a counter sale has no email and inventing a
 * nullable one on the core entity to serve this module would be exactly the
 * coupling the split exists to avoid.
 */
export class OrderMailer {
  protected readonly log = $logger();
  protected readonly orders = $inject(OrderService);
  protected readonly renderer = $inject(OrderMailRenderer);
  protected readonly sessions = $repository(checkoutSessions);

  protected readonly confirmation = $email({ name: "commerce-order-paid" });
  protected readonly shipped = $email({ name: "commerce-order-shipped" });

  /**
   * Send the order confirmation, returning whether one went out — `false`
   * means the order has no email on file (a counter sale), which is a
   * normal outcome, not an error. Throws on render/SMTP failure so the
   * calling workflow step can retry.
   */
  public async sendConfirmationFor(orderId: string): Promise<boolean> {
    const to = await this.recipientOf(orderId);
    if (!to) {
      return false;
    }
    const order = await this.orders.getById(orderId);
    const items = await this.orders.itemsOf(orderId);
    const mail = await this.renderer.confirmation(order, items);
    await this.confirmation.send({ to, ...mail });
    return true;
  }

  protected readonly onShipped = $hook({
    on: "commerce:order:shipped",
    handler: async (event) => {
      try {
        const to = await this.recipientOf(event.orderId);
        if (!to) {
          return;
        }
        const order = await this.orders.getById(event.orderId);
        const mail = await this.renderer.shipped(order);
        await this.shipped.send({ to, ...mail });
      } catch (error) {
        this.log.error("Failed to send a shipping notice", {
          orderId: event.orderId,
          error,
        });
      }
    },
  });

  /**
   * The address the buyer gave at checkout, if there was a checkout at all.
   */
  protected async recipientOf(orderId: string): Promise<string | undefined> {
    const session = await this.sessions.findOne({
      where: { orderId: { eq: orderId } },
    });
    if (!session?.email) {
      this.log.debug("No email on file for this order, sending nothing", {
        orderId,
      });
      return undefined;
    }
    return session.email;
  }
}
