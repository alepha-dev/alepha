import { type Infer, z } from "alepha";

import { webhookDeliveryStatusSchema } from "./webhookDeliveryStatusSchema.ts";

/**
 * A delivery as the log lists it: the outcome, without the envelope.
 */
export const webhookDeliveryResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  updatedAt: z.datetime(),
  endpointId: z.uuid(),
  eventType: z.text({ maxLength: 100 }),
  eventId: z.text({ maxLength: 64 }),
  status: webhookDeliveryStatusSchema,
  attempt: z.integer(),
  responseStatus: z.integer().optional(),
  durationMs: z.integer().optional(),
  deliveredAt: z.datetime().optional(),
  error: z.text({ maxLength: 1000 }).optional(),
});

export type WebhookDeliveryResource = Infer<
  typeof webhookDeliveryResourceSchema
>;
