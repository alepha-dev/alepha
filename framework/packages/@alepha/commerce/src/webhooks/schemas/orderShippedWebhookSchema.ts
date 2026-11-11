import { type Infer, z } from "alepha";

import { webhookOrderLineSchema } from "./webhookOrderLineSchema.ts";
import { webhookShippingAddressSchema } from "./webhookShippingAddressSchema.ts";

/**
 * The data of `order.shipped`: the order and its lines, the carrier's
 * tracking, and the shipping recipient's name and postal address when the
 * checkout recorded one.
 *
 * Never the customer's email, a phone number, billing details, the VAT
 * number, a user id or the order's notes.
 */
export const orderShippedWebhookSchema = z.object({
  orderId: z.uuid(),
  number: z.text({ maxLength: 40 }).optional(),
  status: z.text({ maxLength: 32 }),
  items: z.array(webhookOrderLineSchema),
  shippingMethod: z.text({ maxLength: 64 }).optional(),
  trackingNumber: z.text({ maxLength: 64 }).optional(),
  trackingUrl: z.text({ maxLength: 500 }).optional(),
  shippingAddress: webhookShippingAddressSchema.optional(),
  shippedAt: z.datetime(),
});

export type OrderShippedWebhook = Infer<typeof orderShippedWebhookSchema>;
