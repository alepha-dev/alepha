import { z } from "alepha";
import { UnauthorizedError } from "alepha/server";

/**
 * A webhook request that failed verification, answered 401.
 *
 * `reason` is for the receiver's own log, never for the sender: `headers`
 * (a `webhook-*` header is missing), `timestamp` (outside the tolerance, or
 * not a number) or `signature` (no `v1` signature matches any secret).
 */
export const InvalidWebhookSignatureError = UnauthorizedError.extend({
  name: "INVALID_WEBHOOK_SIGNATURE",
  schema: z.object({
    reason: z.enum(["headers", "timestamp", "signature"]),
  }),
  message: "Invalid webhook signature",
});

export type InvalidWebhookSignatureError = InstanceType<
  typeof InvalidWebhookSignatureError
>;
