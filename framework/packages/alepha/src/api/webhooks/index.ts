import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";

import { WebhookJobs } from "./jobs/WebhookJobs.ts";
import { $webhook } from "./primitives/$webhook.ts";
import { WebhookDeliveryService } from "./services/WebhookDeliveryService.ts";
import { WebhookEndpointService } from "./services/WebhookEndpointService.ts";
import { WebhookSecretService } from "./services/WebhookSecretService.ts";
import { WebhookService } from "./services/WebhookService.ts";
import { HttpWebhookTransport } from "./transports/HttpWebhookTransport.ts";
import { MemoryWebhookTransport } from "./transports/MemoryWebhookTransport.ts";
import { WebhookTransport } from "./transports/WebhookTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/webhookDeliveryEntity.ts";
export * from "./entities/webhookEndpointEntity.ts";
export * from "./jobs/WebhookJobs.ts";
export * from "./primitives/$webhook.ts";
export * from "./schemas/createWebhookEndpointSchema.ts";
export * from "./schemas/webhookDeliveryStatusSchema.ts";
export * from "./schemas/webhookDisabledReasonSchema.ts";
export * from "./schemas/webhookEndpointResourceSchema.ts";
export * from "./schemas/webhookEndpointStatusSchema.ts";
export * from "./schemas/webhookEndpointWithSecretSchema.ts";
export * from "./schemas/webhookEnvelopeSchema.ts";
export * from "./schemas/webhookSendOptionsSchema.ts";
export * from "./services/WebhookDeliveryService.ts";
export * from "./services/WebhookEndpointService.ts";
export * from "./services/WebhookSecretService.ts";
export * from "./services/WebhookService.ts";
export * from "./transports/HttpWebhookTransport.ts";
export * from "./transports/MemoryWebhookTransport.ts";
export * from "./transports/WebhookTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * A delivery's receiver answered a 2xx. Emitted once per delivered
     * delivery. Names the host, never the URL.
     */
    "webhooks:delivery:success": {
      deliveryId: string;
      endpointId: string;
      eventType: string;
      host: string;
      attempt: number;
    };
    /**
     * An attempt of a delivery failed: a non-2xx answer, no answer, or a
     * secret that does not decrypt. Emitted on EVERY failed attempt;
     * `final` says the delivery is now `failed` and will not be retried.
     * Names the host, never the URL.
     */
    "webhooks:delivery:error": {
      deliveryId: string;
      endpointId: string;
      eventType: string;
      host: string;
      attempt: number;
      final: boolean;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Outbound webhooks: signed, retried deliveries on the jobs outbox.
 *
 * **Features:**
 * - `$webhook` declares an event (name, description, schema); `send`
 *   writes one delivery per subscribed endpoint and pushes its job
 * - Endpoints are rows (`webhook_endpoints`), never source: URL, subscribed
 *   events, a secret encrypted with `APP_SECRET`, an optional tenancy
 *   `scope`
 * - A delivery log (`webhook_deliveries`): the envelope, the receiver's
 *   status and an excerpt of its answer, per delivery
 * - Inside a transaction, `send` is a true outbox on Postgres and SQLite
 *
 * Not registered, nothing exists: no table, no job, no route.
 *
 * @module alepha.api.webhooks
 */
export const AlephaApiWebhooks = $module({
  name: "alepha.api.webhooks",
  imports: [AlephaApiJobs],
  primitives: [$webhook],
  services: [
    WebhookSecretService,
    WebhookEndpointService,
    WebhookDeliveryService,
    WebhookJobs,
    WebhookService,
  ],
  variants: [HttpWebhookTransport, MemoryWebhookTransport],
  register: (alepha) => {
    // `optional`: an app (or a spec) that substituted the transport first
    // keeps its own. Under test nothing leaves the process by default.
    alepha.with({
      optional: true,
      provide: WebhookTransport,
      use: alepha.isTest() ? MemoryWebhookTransport : HttpWebhookTransport,
    });
  },
});
