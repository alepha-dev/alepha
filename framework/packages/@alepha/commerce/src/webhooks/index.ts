import { $module } from "alepha";
import { AlephaApiWebhooks } from "alepha/api/webhooks";

import { AlephaCommerce } from "../index.ts";
import { CommerceWebhookListener } from "./services/CommerceWebhookListener.ts";
import { CommerceWebhookPayloads } from "./services/CommerceWebhookPayloads.ts";
import { CommerceWebhooks } from "./services/CommerceWebhooks.ts";

export * from "./schemas/orderCancelledWebhookSchema.ts";
export * from "./schemas/orderPaidWebhookSchema.ts";
export * from "./schemas/orderRefundedWebhookSchema.ts";
export * from "./schemas/orderShippedWebhookSchema.ts";
export * from "./schemas/returnRequestedWebhookSchema.ts";
export * from "./schemas/webhookOrderLineSchema.ts";
export * from "./schemas/webhookShippingAddressSchema.ts";
export * from "./services/CommerceWebhookListener.ts";
export * from "./services/CommerceWebhookPayloads.ts";
export * from "./services/CommerceWebhooks.ts";

/**
 * Commerce order events as outbound webhooks: `order.paid`, `order.shipped`,
 * `order.refunded`, `order.cancelled` and `return.requested`, for the tools
 * a shop connects (fulfilment, accounting, an automation).
 *
 * Opt-in: a shop that does not register it gets no webhook table and no
 * admin entry. It registers `AlephaApiWebhooks`, so the admin's Webhooks
 * page appears with it.
 *
 * The events are sent after the order's commit, not atomically with it.
 * `order.paid` and `order.shipped` carry the shipping recipient's name and
 * postal address; no event carries the customer's email, a phone number,
 * billing details, a VAT number or a user id.
 *
 * @module alepha.commerce.webhooks
 */
export const AlephaCommerceWebhooks = $module({
  name: "alepha.commerce.webhooks",
  imports: [AlephaCommerce, AlephaApiWebhooks],
  services: [
    CommerceWebhooks,
    CommerceWebhookPayloads,
    CommerceWebhookListener,
  ],
});
