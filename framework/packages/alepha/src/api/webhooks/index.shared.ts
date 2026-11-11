import type { ModulePrimitiveOptions } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { AlephaApiJobs } from "alepha/api/jobs";

import { WebhookAudits } from "./audits/WebhookAudits.ts";
import { AdminWebhookController } from "./controllers/AdminWebhookController.ts";
import { WebhookJobs } from "./jobs/WebhookJobs.ts";
import { WebhookNotifications } from "./notifications/WebhookNotifications.ts";
import { $webhook } from "./primitives/$webhook.ts";
import { WebhookBuiltins } from "./primitives/WebhookBuiltins.ts";
import { WebhookAddressResolver } from "./services/WebhookAddressResolver.ts";
import { WebhookDeliveryService } from "./services/WebhookDeliveryService.ts";
import { WebhookDestinationPolicy } from "./services/WebhookDestinationPolicy.ts";
import { WebhookEndpointService } from "./services/WebhookEndpointService.ts";
import { WebhookHealthService } from "./services/WebhookHealthService.ts";
import { WebhookOutbox } from "./services/WebhookOutbox.ts";
import { WebhookSecretService } from "./services/WebhookSecretService.ts";
import { WebhookService } from "./services/WebhookService.ts";
import { HttpWebhookTransport } from "./transports/HttpWebhookTransport.ts";
import { MemoryWebhookTransport } from "./transports/MemoryWebhookTransport.ts";
import { WebhookTransport } from "./transports/WebhookTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./audits/WebhookAudits.ts";
export * from "./controllers/AdminWebhookController.ts";
export * from "./entities/webhookDeliveryEntity.ts";
export * from "./entities/webhookEndpointEntity.ts";
export * from "./errors/WebhookDestinationRefusedError.ts";
export * from "./errors/WebhookEndpointNotActiveError.ts";
export * from "./errors/WebhookPayloadTooLargeError.ts";
export * from "./jobs/WebhookJobs.ts";
export * from "./notifications/WebhookNotifications.ts";
export * from "./primitives/$webhook.ts";
export * from "./primitives/WebhookBuiltins.ts";
export * from "./schemas/createWebhookEndpointSchema.ts";
export * from "./schemas/rotateWebhookSecretSchema.ts";
export * from "./schemas/updateWebhookEndpointSchema.ts";
export * from "./schemas/webhookDeliveryDetailResourceSchema.ts";
export * from "./schemas/webhookDeliveryQuerySchema.ts";
export * from "./schemas/webhookDeliveryRefSchema.ts";
export * from "./schemas/webhookDeliveryResourceSchema.ts";
export * from "./schemas/webhookDeliveryStatusSchema.ts";
export * from "./schemas/webhookDisabledReasonSchema.ts";
export * from "./schemas/webhookEndpointQuerySchema.ts";
export * from "./schemas/webhookEndpointResourceSchema.ts";
export * from "./schemas/webhookEndpointStatusSchema.ts";
export * from "./schemas/webhookEndpointWithSecretSchema.ts";
export * from "./schemas/webhookEnvelopeSchema.ts";
export * from "./schemas/webhookEventResourceSchema.ts";
export * from "./schemas/webhookOptionsAtom.ts";
export * from "./schemas/webhookScopeQuerySchema.ts";
export * from "./schemas/webhookSendOptionsSchema.ts";
export * from "./services/WebhookAddressResolver.ts";
export * from "./services/WebhookDeliveryService.ts";
export * from "./services/WebhookDestinationPolicy.ts";
export * from "./services/WebhookEndpointService.ts";
export * from "./services/WebhookHealthService.ts";
export * from "./services/WebhookOutbox.ts";
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
    /**
     * The module disabled an endpoint by itself: the receiver answered
     * `410 Gone` (`gone`), it kept failing for `disableAfterDays`
     * (`failing`), or its secret no longer decrypts (`secret`). Emitted on
     * every automatic disable, so an app can alert its own way. Names the
     * host, never the URL.
     */
    "webhooks:endpoint:disabled": {
      endpointId: string;
      host: string;
      reason: "gone" | "failing" | "secret";
      scope?: string;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------------

/**
 * What every runtime's build of `AlephaApiWebhooks` shares; each barrel
 * adds its own address resolver.
 */
export const webhooksModuleOptions = {
  name: "alepha.api.webhooks",
  imports: [AlephaApiJobs, AlephaApiAudits],
  primitives: [$webhook],
  services: [
    WebhookSecretService,
    WebhookAddressResolver,
    WebhookDestinationPolicy,
    WebhookEndpointService,
    WebhookHealthService,
    WebhookDeliveryService,
    WebhookJobs,
    WebhookOutbox,
    WebhookService,
    WebhookBuiltins,
    WebhookAudits,
    AdminWebhookController,
  ],
  // `WebhookNotifications` is never registered here: the module stays
  // usable without `alepha/api/notifications`. An app turns the disabled
  // notice on with `alepha.with(WebhookNotifications)`.
  variants: [
    HttpWebhookTransport,
    MemoryWebhookTransport,
    WebhookNotifications,
  ],
  register: (alepha) => {
    // `optional`: an app (or a spec) that substituted the transport first
    // keeps its own. Under test nothing leaves the process by default.
    alepha.with({
      optional: true,
      provide: WebhookTransport,
      use: alepha.isTest() ? MemoryWebhookTransport : HttpWebhookTransport,
    });
  },
} satisfies ModulePrimitiveOptions;
