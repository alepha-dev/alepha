import { type Infer, z } from "alepha";

import { webhookDeliveryResourceSchema } from "./webhookDeliveryResourceSchema.ts";
import { webhookEnvelopeSchema } from "./webhookEnvelopeSchema.ts";

/**
 * One delivery in full: the envelope sent, the excerpt of the answer, and
 * the endpoint's host (never its URL).
 */
export const webhookDeliveryDetailResourceSchema =
  webhookDeliveryResourceSchema.extend({
    payload: webhookEnvelopeSchema,
    responseExcerpt: z.text({ maxLength: 4096 }).optional(),
    host: z.text({ maxLength: 255 }),
  });

export type WebhookDeliveryDetailResource = Infer<
  typeof webhookDeliveryDetailResourceSchema
>;
