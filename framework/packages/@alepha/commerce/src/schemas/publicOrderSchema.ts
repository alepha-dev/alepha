import { type Infer, z } from "alepha";

import { orderStatusEnum } from "./orderStatusSchema.ts";

/**
 * An order as a customer reads it.
 *
 * Spelled out, like `publicProductSchema`: what the shop keeps about a sale (the
 * payment intent, stray captures, its own notes, whose account it is) stays
 * behind this list. `shippingAddress` is filled for the buyer alone.
 */
export const publicOrderSchema = z.object({
  id: z.uuid(),
  number: z.text().optional(),
  createdAt: z.text(),
  status: orderStatusEnum,
  total: z.integer(),
  discountTotal: z.integer(),
  promotionCode: z.text().optional(),
  shippingTotal: z.integer(),
  taxTotal: z.integer(),
  refundedTotal: z.integer(),
  currency: z.text(),
  shippingMethod: z.text().optional(),
  trackingNumber: z.text().optional(),
  trackingUrl: z.text({ maxLength: 500 }).optional(),
  shippedAt: z.text().optional(),
  deliveredAt: z.text().optional(),
  shippingAddress: z.record(z.text(), z.any()).optional(),
});

export type PublicOrder = Infer<typeof publicOrderSchema>;
