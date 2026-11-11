import { type Infer, z } from "alepha";

/**
 * The data of `return.requested`: which order lines, and how many of each,
 * a customer is sending back.
 *
 * Carries no personal data at all, and not the customer's free-text reason.
 */
export const returnRequestedWebhookSchema = z.object({
  returnId: z.uuid(),
  orderId: z.uuid(),
  number: z.text({ maxLength: 40 }).optional(),
  lines: z.array(
    z.object({
      orderItemId: z.uuid(),
      quantity: z.integer(),
    }),
  ),
  requestedAt: z.datetime(),
});

export type ReturnRequestedWebhook = Infer<typeof returnRequestedWebhookSchema>;
