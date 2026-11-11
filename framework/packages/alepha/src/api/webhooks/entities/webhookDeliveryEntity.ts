import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { webhookDeliveryStatusSchema } from "../schemas/webhookDeliveryStatusSchema.ts";
import { webhookEnvelopeSchema } from "../schemas/webhookEnvelopeSchema.ts";
import { webhookEndpointEntity } from "./webhookEndpointEntity.ts";

/**
 * One event sent to one endpoint: what was sent, and what the receiver
 * answered.
 *
 * **The delivery log is the product.** "What did we send and what did they
 * answer" is the support question, so the envelope, the last response
 * status, an excerpt of its body and the duration are kept for the
 * retention window, whatever the outcome.
 *
 * A row is written by `$webhook`'s `send` and moved by the
 * `system.webhooks.deliver` job keyed by its id. A redelivery is a new row
 * with the same envelope (and so the same `eventId`): a row is never
 * rewritten into another delivery.
 */
export const webhookDeliveryEntity = $entity({
  name: "webhook_deliveries",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    endpointId: db.ref(z.uuid(), () => webhookEndpointEntity.cols.id, {
      onDelete: "cascade",
    }),
    eventType: z.text({ maxLength: 100 }),

    /**
     * The envelope's id: the `webhook-id` header, stable across retries and
     * redeliveries, which is what a receiver dedups on.
     */
    eventId: z.text({ maxLength: 64 }),

    /**
     * The full envelope `{ id, type, timestamp, data }` as sent.
     */
    payload: webhookEnvelopeSchema,

    status: db.default(webhookDeliveryStatusSchema, "pending"),

    /**
     * How many requests this delivery has made, its own counter: the job's
     * attempt restarts after a resume, this one does not.
     */
    attempt: db.default(z.integer(), 0),
    responseStatus: z.integer().optional(),

    /**
     * The first 2 KB of the last response body, as text.
     */
    responseExcerpt: z.text({ maxLength: 4096 }).optional(),
    durationMs: z.integer().optional(),
    deliveredAt: z.datetime().optional(),

    /**
     * Why the last attempt failed, when it did. Never the endpoint's URL.
     */
    error: z.text({ maxLength: 1000 }).optional(),
  }),
  indexes: [
    { columns: ["endpointId", "createdAt"] },
    { columns: ["eventType", "createdAt"] },
    { columns: ["status"] },
  ],
});

export type WebhookDeliveryEntity = Infer<typeof webhookDeliveryEntity.schema>;
