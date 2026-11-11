import { type Infer, z } from "alepha";

/**
 * The delivery an action wrote (a redelivery, a test event), so a screen can
 * follow it to its outcome.
 */
export const webhookDeliveryRefSchema = z.object({
  deliveryId: z.uuid(),
});

export type WebhookDeliveryRef = Infer<typeof webhookDeliveryRefSchema>;
