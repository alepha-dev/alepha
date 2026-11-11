import { type Infer, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

import { webhookDeliveryStatusSchema } from "./webhookDeliveryStatusSchema.ts";

/**
 * Filters of the delivery log: an endpoint, an event type, a status, a
 * creation date range, and the tenancy scope of the endpoints.
 */
export const webhookDeliveryQuerySchema = pageQuerySchema.extend({
  endpointId: z.uuid().optional(),
  eventType: z.text({ maxLength: 100 }).optional(),
  status: webhookDeliveryStatusSchema.optional(),
  from: z.datetime().optional(),
  to: z.datetime().optional(),
  scope: z.text({ maxLength: 255 }).optional(),
});

export type WebhookDeliveryQuery = Infer<typeof webhookDeliveryQuerySchema>;
