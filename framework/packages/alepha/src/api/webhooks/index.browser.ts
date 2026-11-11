import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./schemas/createWebhookEndpointSchema.ts";
export * from "./schemas/webhookDeliveryStatusSchema.ts";
export * from "./schemas/webhookDisabledReasonSchema.ts";
export * from "./schemas/webhookEndpointResourceSchema.ts";
export * from "./schemas/webhookEndpointStatusSchema.ts";
export * from "./schemas/webhookEndpointWithSecretSchema.ts";
export * from "./schemas/webhookEnvelopeSchema.ts";
export * from "./schemas/webhookSendOptionsSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiWebhooks = $module({
  name: "alepha.api.webhooks",
  services: [],
});
