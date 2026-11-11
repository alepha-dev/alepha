import { type Infer, z } from "alepha";

/**
 * A webhook endpoint's state: `active` receives events, `paused` receives
 * none until resumed, `disabled` was stopped by the module and waits for an
 * operator.
 */
export const webhookEndpointStatusSchema = z.enum([
  "active",
  "paused",
  "disabled",
]);

export type WebhookEndpointStatus = Infer<typeof webhookEndpointStatusSchema>;
