import { type Infer, z } from "alepha";

/**
 * Options of `$webhook`'s `send`. `scope` is the app's own tenancy key: an
 * event sent with a scope reaches the unscoped endpoints and the endpoints
 * of exactly that scope; one sent without reaches the unscoped ones only.
 */
export const webhookSendOptionsSchema = z.object({
  scope: z.text({ maxLength: 255 }).optional(),
});

export type WebhookSendOptions = Infer<typeof webhookSendOptionsSchema>;
