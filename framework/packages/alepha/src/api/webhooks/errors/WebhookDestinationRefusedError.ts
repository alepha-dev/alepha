import { ValidationError } from "alepha/server";

/**
 * A webhook endpoint URL the destination policy refuses: wrong scheme,
 * credentials or a fragment, an unlisted port, or a private, loopback,
 * link-local or local-name host. A 400 on the `url` field, so a form puts
 * the message under it. The message names the host, never the URL.
 */
export const WebhookDestinationRefusedError = ValidationError.extend({
  name: "WEBHOOK_DESTINATION_REFUSED",
  message: "This webhook destination is not allowed",
});

export type WebhookDestinationRefusedError = InstanceType<
  typeof WebhookDestinationRefusedError
>;
