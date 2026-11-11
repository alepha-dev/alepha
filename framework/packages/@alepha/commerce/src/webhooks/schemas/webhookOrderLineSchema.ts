import { type Infer, z } from "alepha";

/**
 * One line of an order as a webhook carries it. Amounts are integers in the
 * currency's minor unit (cents).
 */
export const webhookOrderLineSchema = z.object({
  sku: z.text({ maxLength: 64 }).optional(),
  name: z.text({ maxLength: 200 }),
  quantity: z.integer(),
  unitPrice: z.integer(),
});

export type WebhookOrderLine = Infer<typeof webhookOrderLineSchema>;
