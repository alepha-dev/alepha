import { type Infer, z } from "alepha";

/**
 * What an endpoint edit may change. `status` moves between `active` and
 * `paused` only: a disabled endpoint is enabled by its own action.
 */
export const updateWebhookEndpointSchema = z.object({
  url: z.text({ maxLength: 2048 }).optional(),
  description: z.text({ maxLength: 500 }).optional(),
  events: z.array(z.text({ maxLength: 100 })).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

export type UpdateWebhookEndpoint = Infer<typeof updateWebhookEndpointSchema>;
