import { $inject } from "alepha";
import { $email } from "alepha/email";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { checkoutSessions } from "../../checkout/entities/checkoutSessions.ts";
import { OrderDownloadsProvider } from "../../providers/OrderDownloadsProvider.ts";
import { OrderService } from "../../services/OrderService.ts";
import { OrderMailRenderer } from "../providers/OrderMailRenderer.ts";

/**
 * Sends the two emails a buyer expects: "we got your order" and "it's on its
 * way".
 *
 * Neither is sent from here on its own. Both are jobs of
 * `@alepha/commerce/settlement`, which call {@link sendConfirmationFor} and
 * {@link sendShippingNoticeFor} with retry instead of the swallowed-error hooks
 * that used to live here: an SMTP outage now means a visible, retryable
 * execution rather than a silently lost email. Import the settlement module to
 * send them at all.
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
  protected readonly downloads = $inject(OrderDownloadsProvider);

  protected readonly confirmation = $email({ name: "commerce-order-paid" });
  protected readonly shipped = $email({ name: "commerce-order-shipped" });

  /**
   * Send the order confirmation, returning whether one went out - `false`
   * means the order has no email on file (a counter sale), which is a
   * normal outcome, not an error. Throws on render/SMTP failure so the
   * calling job can retry.
   */
  public async sendConfirmationFor(orderId: string): Promise<boolean> {
    const to = await this.recipientOf(orderId);
    if (!to) {
      return false;
    }
    const order = await this.orders.getById(orderId);
    const items = await this.orders.itemsOf(orderId);
    const mail = await this.renderer.confirmation(
      order,
      items,
      await this.downloads.linksFor(orderId),
    );
    await this.confirmation.send({ to, ...mail });
    return true;
  }

  /**
   * Send the "it's on its way" email, on the same terms as
   * {@link sendConfirmationFor}. The tracking link is in it, so a lost one
   * leaves the buyer with no way to follow the parcel.
   */
  public async sendShippingNoticeFor(orderId: string): Promise<boolean> {
    const to = await this.recipientOf(orderId);
    if (!to) {
      return false;
    }
    const order = await this.orders.getById(orderId);
    const mail = await this.renderer.shipped(order);
    await this.shipped.send({ to, ...mail });
    return true;
  }

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
