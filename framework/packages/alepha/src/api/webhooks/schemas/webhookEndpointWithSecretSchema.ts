import { type Infer, z } from "alepha";

import { webhookEndpointResourceSchema } from "./webhookEndpointResourceSchema.ts";

/**
 * An endpoint and its signing secret in clear: the answer of a creation or
 * a rotation, the only two moments the secret is ever shown.
 */
export const webhookEndpointWithSecretSchema = z.object({
  endpoint: webhookEndpointResourceSchema,
  secret: z.text({ maxLength: 100 }),
});

export type WebhookEndpointWithSecret = Infer<
  typeof webhookEndpointWithSecretSchema
>;
