import { type Infer, z } from "alepha";

/**
 * A delivery's outcome: `pending` until the receiver answers a 2xx
 * (`delivered`) or the module gives up (`failed`).
 */
export const webhookDeliveryStatusSchema = z.enum([
  "pending",
  "delivered",
  "failed",
]);

export type WebhookDeliveryStatus = Infer<typeof webhookDeliveryStatusSchema>;
