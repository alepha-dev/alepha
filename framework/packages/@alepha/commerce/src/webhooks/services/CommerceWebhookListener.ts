import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";

import { CommerceWebhookPayloads } from "./CommerceWebhookPayloads.ts";
import { CommerceWebhooks } from "./CommerceWebhooks.ts";

/**
 * Sends the five commerce webhooks from the internal events.
 *
 * **After the commit, by design, and not atomic with the order.** Every one
 * of these events is emitted through `DatabaseProvider.afterCommit`, so the
 * listener reads a committed order on every database, D1 included. The
 * price: a crash between the commit and this listener loses that webhook,
 * exactly as it loses the settlement job pushed from the same event.
 * Accepted.
 *
 * **It never throws into the emitter.** `commerce:order:paid` is emitted
 * after the money is in, to whoever called `markPaid` (the payment
 * webhook): a webhook that cannot be queued must never fail a settlement.
 * Every handler catches and logs.
 */
export class CommerceWebhookListener {
  protected readonly log = $logger();
  protected readonly webhooks = $inject(CommerceWebhooks);
  protected readonly payloads = $inject(CommerceWebhookPayloads);

  protected readonly onPaid = $hook({
    on: "commerce:order:paid",
    handler: (event) =>
      this.safely("order.paid", event.orderId, async () =>
        this.webhooks.orderPaid.send(await this.payloads.paid(event.orderId)),
      ),
  });

  protected readonly onShipped = $hook({
    on: "commerce:order:shipped",
    handler: (event) =>
      this.safely("order.shipped", event.orderId, async () =>
        this.webhooks.orderShipped.send(
          await this.payloads.shipped(event.orderId),
        ),
      ),
  });

  protected readonly onRefunded = $hook({
    on: "commerce:order:refunded",
    handler: (event) =>
      this.safely("order.refunded", event.orderId, async () =>
        this.webhooks.orderRefunded.send(
          await this.payloads.refunded(event.refundId),
        ),
      ),
  });

  protected readonly onCancelled = $hook({
    on: "commerce:order:cancelled",
    handler: (event) =>
      this.safely("order.cancelled", event.orderId, async () =>
        this.webhooks.orderCancelled.send(
          await this.payloads.cancelled(event.orderId),
        ),
      ),
  });

  protected readonly onReturnRequested = $hook({
    on: "commerce:return:requested",
    handler: (event) =>
      this.safely("return.requested", event.orderId, async () =>
        this.webhooks.returnRequested.send(
          await this.payloads.returnRequested(event.returnId),
        ),
      ),
  });

  protected async safely(
    eventType: string,
    orderId: string,
    send: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.log.error("Commerce webhook not queued", {
        eventType,
        orderId,
        error,
      });
    }
  }
}
