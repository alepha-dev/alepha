import { type Infer, z } from "alepha";

import { webhookOrderLineSchema } from "./webhookOrderLineSchema.ts";
import { webhookShippingAddressSchema } from "./webhookShippingAddressSchema.ts";

/**
 * The data of `order.paid`: the order, its totals and lines, how it ships,
 * and the shipping recipient's name and postal address when the checkout
 * recorded one. Amounts are integers in the currency's minor unit.
 *
 * Carries no payment instrument, and never the customer's email, a phone
 * number, billing details, the VAT number, a user id or the order's notes.
 */
export const orderPaidWebhookSchema = z.object({
  orderId: z.uuid(),
  number: z.text({ maxLength: 40 }).optional(),
  status: z.text({ maxLength: 32 }),
  currency: z.text({ minLength: 3, maxLength: 3 }),
  total: z.integer(),
  discountTotal: z.integer(),
  shippingTotal: z.integer(),
  taxTotal: z.integer(),
  items: z.array(webhookOrderLineSchema),
  shippingMethod: z.text({ maxLength: 64 }).optional(),
  shippingAddress: webhookShippingAddressSchema.optional(),
  createdAt: z.datetime(),
  paidAt: z.datetime(),
});

export type OrderPaidWebhook = Infer<typeof orderPaidWebhookSchema>;
