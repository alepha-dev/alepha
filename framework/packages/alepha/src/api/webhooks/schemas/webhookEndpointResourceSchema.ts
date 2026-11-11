import { type Infer, z } from "alepha";

import { webhookDisabledReasonSchema } from "./webhookDisabledReasonSchema.ts";
import { webhookEndpointStatusSchema } from "./webhookEndpointStatusSchema.ts";

/**
 * A webhook endpoint as every read returns it.
 *
 * **Never a secret.** The signing secret is shown once, at creation and at
 * rotation, and never again: a read carries `secretPrefix` (enough to tell
 * two apart) and whether a rotated-out secret still signs.
 */
export const webhookEndpointResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  updatedAt: z.datetime(),
  url: z.text({ maxLength: 2048 }),
  description: z.text({ maxLength: 500 }).optional(),
  events: z.array(z.text({ maxLength: 100 })),
  status: webhookEndpointStatusSchema,
  disabledReason: webhookDisabledReasonSchema.optional(),
  scope: z.text({ maxLength: 255 }).optional(),
  createdBy: z.uuid().optional(),
  secretPrefix: z.text({ maxLength: 10 }),
  hasPreviousSecret: z.boolean(),
  previousSecretExpiresAt: z.datetime().optional(),
  failingSince: z.datetime().optional(),
  lastDeliveryAt: z.datetime().optional(),
  lastSuccessAt: z.datetime().optional(),
});

export type WebhookEndpointResource = Infer<
  typeof webhookEndpointResourceSchema
>;
