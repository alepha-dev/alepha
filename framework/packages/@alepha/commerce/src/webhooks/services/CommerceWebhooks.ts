import { $webhook } from "alepha/api/webhooks";

import { orderCancelledWebhookSchema } from "../schemas/orderCancelledWebhookSchema.ts";
import { orderPaidWebhookSchema } from "../schemas/orderPaidWebhookSchema.ts";
import { orderRefundedWebhookSchema } from "../schemas/orderRefundedWebhookSchema.ts";
import { orderShippedWebhookSchema } from "../schemas/orderShippedWebhookSchema.ts";
import { returnRequestedWebhookSchema } from "../schemas/returnRequestedWebhookSchema.ts";

/**
 * The five order events a shop sends to the tools around it: fulfilment,
 * accounting, a spreadsheet automation. Each payload is a public contract,
 * built deliberately from the order (see `CommerceWebhookPayloads`), never
 * the internal event forwarded.
 */
export class CommerceWebhooks {
  public readonly orderPaid = $webhook({
    name: "order.paid",
    description:
      "An order was paid in full. Carries its lines, totals, shipping method and the shipping recipient's name and postal address, when there is one.",
    schema: orderPaidWebhookSchema,
  });

  public readonly orderShipped = $webhook({
    name: "order.shipped",
    description:
      "An order was handed to a carrier. Carries its lines, the tracking number and URL, and the shipping recipient's name and postal address.",
    schema: orderShippedWebhookSchema,
  });

  public readonly orderRefunded = $webhook({
    name: "order.refunded",
    description:
      "An order was refunded, in part or in full. Compare refundedTotal with total to tell a partial refund from a full one.",
    schema: orderRefundedWebhookSchema,
  });

  public readonly orderCancelled = $webhook({
    name: "order.cancelled",
    description: "An unpaid order was cancelled and will not be paid.",
    schema: orderCancelledWebhookSchema,
  });

  public readonly returnRequested = $webhook({
    name: "return.requested",
    description:
      "A customer asked to send order lines back. Carries the lines and their quantities.",
    schema: returnRequestedWebhookSchema,
  });
}
