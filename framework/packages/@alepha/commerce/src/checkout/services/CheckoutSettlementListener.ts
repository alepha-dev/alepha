import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";

import { OrderService } from "../../services/OrderService.ts";
import { CheckoutService } from "./CheckoutService.ts";

/**
 * Settles a checkout when its payment is captured.
 *
 * Subscribing to the payment rail's own hook rather than exposing a "confirm"
 * endpoint means the consumer wires nothing: the PSP webhook already lands in
 * `alepha/api/payments`, which emits `payments:captured`, and the order becomes
 * paid from there. An application that never calls `settle()` still gets
 * correct orders.
 *
 * The intent's metadata is the join key. It is written by
 * `RedirectCheckoutPayment.start()`; an intent created by something else in the
 * same application carries no `checkoutSessionId` and is ignored here.
 */
export class CheckoutSettlementListener {
  protected readonly log = $logger();
  protected readonly checkout = $inject(CheckoutService);
  protected readonly orders = $inject(OrderService);

  protected readonly onCaptured = $hook({
    on: "payments:captured",
    handler: async (event) => {
      const sessionId = (event.metadata as { checkoutSessionId?: string })
        ?.checkoutSessionId;

      if (!sessionId) {
        // Not ours - some other part of the app took this payment.
        return;
      }

      this.log.debug("Settling checkout from payments:captured", {
        sessionId,
        intentId: event.intentId,
      });

      await this.checkout.settle(sessionId, {
        paymentIntentId: event.intentId,
      });
    },
  });

  /**
   * Record a refund against the order, at the amount the rail reports.
   *
   * `refundedTotal`, not `amount`: the event is delivered at least once, and
   * the intent already holds the ledger of every refund against it, so passing
   * the sum lets the order SET its refunded total instead of adding to it. A
   * redelivered event then changes nothing.
   *
   * Before this, any refund event whatsoever moved the order to `refunded` -
   * so a ten percent goodwill gesture read, in the back office and in the
   * customer's own history, exactly like a sale that had been undone.
   *
   * An order that never took the money (`pending`, or `cancelled` with a
   * stray capture recorded against it) is left as it is: the refund gives
   * back money the order never held.
   */
  protected readonly onRefunded = $hook({
    on: "payments:refunded",
    handler: async (event) => {
      const sessionId = (event.metadata as { checkoutSessionId?: string })
        ?.checkoutSessionId;
      if (!sessionId) {
        return;
      }

      const session = await this.checkout.getById(sessionId);
      if (!session.orderId) {
        return;
      }
      const order = await this.orders.getById(session.orderId);
      if (order.status === "pending" || order.status === "cancelled") {
        return;
      }
      await this.checkout.refundOrder(session.orderId, {
        refundedTotal: event.refundedTotal,
      });
    },
  });

  /**
   * A payment that failed or was abandoned must give its stock back at once.
   *
   * Every read already skips an expired hold, but a hold lives until its TTL,
   * so without this the last ring stays invisible, up to that TTL, to a buyer
   * who would have paid for it. Releasing on the failure event costs nothing
   * and closes that window.
   */
  protected readonly onFailed = $hook({
    on: "payments:failed",
    handler: async (event) => {
      const sessionId = (event.metadata as { checkoutSessionId?: string })
        ?.checkoutSessionId;
      if (!sessionId) {
        return;
      }

      this.log.debug("Cancelling checkout from payments:failed", {
        sessionId,
        intentId: event.intentId,
      });

      await this.checkout.abandonWithOrder(sessionId);
    },
  });

  /**
   * An intent the payment sweep expired is a failure with a different
   * name: the buyer opened the PSP page and never finished. Same
   * treatment - the session and its pending order must not sit in a
   * `paying` graveyard forever.
   */
  protected readonly onExpired = $hook({
    on: "payments:expired",
    handler: async (event) => {
      const sessionId = (event.metadata as { checkoutSessionId?: string })
        ?.checkoutSessionId;
      if (!sessionId) {
        return;
      }

      this.log.debug("Cancelling checkout from payments:expired", {
        sessionId,
        intentId: event.intentId,
      });

      await this.checkout.abandonWithOrder(sessionId);
    },
  });
}
