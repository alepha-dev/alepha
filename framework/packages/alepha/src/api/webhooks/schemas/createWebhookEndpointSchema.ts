import { type Infer, z } from "alepha";

/**
 * What registering a webhook endpoint takes: where to send, a note for the
 * operator, the event names it subscribes to (empty or absent for all), and
 * the app's own tenancy key when the endpoint belongs to one tenant.
 */
export const createWebhookEndpointSchema = z.object({
  url: z.text({ maxLength: 2048 }),
  description: z.text({ maxLength: 500 }).optional(),
  events: z.array(z.text({ maxLength: 100 })).optional(),
  scope: z.text({ maxLength: 255 }).optional(),
});

export type CreateWebhookEndpoint = Infer<typeof createWebhookEndpointSchema>;
