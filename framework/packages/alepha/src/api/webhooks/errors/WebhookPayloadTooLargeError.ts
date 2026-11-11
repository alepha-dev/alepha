import { z } from "alepha";
import { HttpError } from "alepha/server";

/**
 * A webhook event whose serialised envelope is larger than
 * `webhookOptions.maxPayloadBytes` (256 KB by default). Thrown by `send`
 * before anything is written.
 */
export const WebhookPayloadTooLargeError = HttpError.extend({
  name: "WEBHOOK_PAYLOAD_TOO_LARGE",
  schema: z.object({ bytes: z.integer(), limit: z.integer() }),
  default: { status: 413 },
  message: "The webhook payload is too large",
});

export type WebhookPayloadTooLargeError = InstanceType<
  typeof WebhookPayloadTooLargeError
>;
