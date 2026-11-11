import { type Infer, z } from "alepha";

/**
 * The data of `order.refunded`: what this refund gave back, everything given
 * back so far, and the order's total, to tell a partial refund from a full
 * one. Amounts are integers in the currency's minor unit.
 *
 * Carries no personal data at all, and not the operator's free-text reason.
 */
export const orderRefundedWebhookSchema = z.object({
  orderId: z.uuid(),
  number: z.text({ maxLength: 40 }).optional(),
  refundId: z.uuid(),
  status: z.text({ maxLength: 32 }),
  currency: z.text({ minLength: 3, maxLength: 3 }),
  total: z.integer(),
  amount: z.integer(),
  refundedTotal: z.integer(),
  refundedAt: z.datetime(),
});

export type OrderRefundedWebhook = Infer<typeof orderRefundedWebhookSchema>;
