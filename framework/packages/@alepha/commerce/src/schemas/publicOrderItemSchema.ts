import { type Infer, z } from "alepha";

/**
 * An order line as its buyer may read it.
 *
 * Spelled out rather than `orderItems.schema.omit({ config: true })`, for the
 * reason `publicProductSchema` is: a list of what may leave means a new column
 * stays internal until somebody decides otherwise. The line's `config` is the
 * merchant's snapshot of the product, and for a digital product that is the
 * file itself: answering it here handed the download URL to anyone who reached
 * `pay()`, paid or not.
 */
export const publicOrderItemSchema = z.object({
  id: z.uuid(),
  createdAt: z.text(),
  orderId: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  kind: z.text({ maxLength: 64 }),
  name: z.text({ maxLength: 200 }),
  sku: z.text({ maxLength: 64 }).optional(),
  variantLabel: z.text({ maxLength: 200 }).optional(),
  unitPrice: z.integer(),
  discount: z.integer(),
  rateBps: z.integer().optional(),
  quantity: z.integer(),
  refundedQuantity: z.integer(),
  /**
   * What the buyer chose themselves: the court and the interval.
   */
  lineConfig: z.record(z.text(), z.any()).optional(),
});

export type PublicOrderItem = Infer<typeof publicOrderItemSchema>;
