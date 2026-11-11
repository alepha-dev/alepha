import { type Infer, z } from "alepha";

/**
 * The body of every webhook request: the event's id (also sent as the
 * `webhook-id` header, stable across retries), its type, when it happened,
 * and its data, shaped by the `$webhook`'s own schema.
 *
 * Defined once, here: the OpenAPI document's `x-webhooks` section and the
 * event catalog are both derived from it.
 */
export const webhookEnvelopeSchema = z.object({
  id: z.text({ maxLength: 64 }),
  type: z.text({ maxLength: 100 }),
  timestamp: z.datetime(),
  data: z.record(z.text(), z.any()),
});

export type WebhookEnvelope = Infer<typeof webhookEnvelopeSchema>;
