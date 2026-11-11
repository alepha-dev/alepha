import { type Infer, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

import { webhookEndpointStatusSchema } from "./webhookEndpointStatusSchema.ts";

/**
 * Filters of the endpoint list: status, a subscribed event (an endpoint
 * subscribed to every event matches any), the tenancy scope, and a search
 * on the URL and the description.
 */
export const webhookEndpointQuerySchema = pageQuerySchema.extend({
  status: webhookEndpointStatusSchema.optional(),
  event: z.text({ maxLength: 100 }).optional(),
  scope: z.text({ maxLength: 255 }).optional(),
  search: z.text({ maxLength: 200 }).optional(),
});

export type WebhookEndpointQuery = Infer<typeof webhookEndpointQuerySchema>;
