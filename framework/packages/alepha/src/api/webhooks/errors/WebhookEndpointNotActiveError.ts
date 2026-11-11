import { ConflictError } from "alepha/server";

/**
 * A redelivery or a test event asked of an endpoint that is not `active`:
 * its job would send nothing. Resume or enable the endpoint first.
 */
export const WebhookEndpointNotActiveError = ConflictError.extend({
  name: "WEBHOOK_ENDPOINT_NOT_ACTIVE",
  message: "The webhook endpoint is not active",
});

export type WebhookEndpointNotActiveError = InstanceType<
  typeof WebhookEndpointNotActiveError
>;
