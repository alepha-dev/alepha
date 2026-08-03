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
 * Driven by the domain's own events, so a shop gets both by importing the
 * module and nothing else. Failures are logged and swallowed — an SMTP outage
 * must not roll back a settled sale, and the order is the record of truth, not
 * the email.
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

  protected readonly onPaid = $hook({
    on: "commerce:order:paid",
    handler: async (event) => {
      try {
        const to = await this.recipientOf(event.orderId);
        if (!to) {
          return;
        }
        const order = await this.orders.getById(event.orderId);
        const items = await this.orders.itemsOf(event.orderId);
        const mail = await this.renderer.confirmation(order, items);
        await this.confirmation.send({ to, ...mail });
      } catch (error) {
        this.log.error("Failed to send an order confirmation", {
          orderId: event.orderId,
          error,
        });
      }
    },
  });

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
