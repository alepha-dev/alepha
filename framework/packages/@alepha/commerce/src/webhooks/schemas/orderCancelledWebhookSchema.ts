import { type Infer, z } from "alepha";

/**
 * The data of `order.cancelled`: an unpaid order that will not be paid.
 *
 * Carries no personal data at all.
 */
export const orderCancelledWebhookSchema = z.object({
  orderId: z.uuid(),
  number: z.text({ maxLength: 40 }).optional(),
  status: z.text({ maxLength: 32 }),
  currency: z.text({ minLength: 3, maxLength: 3 }),
  total: z.integer(),
  cancelledAt: z.datetime(),
});

export type OrderCancelledWebhook = Infer<typeof orderCancelledWebhookSchema>;
