import { type Infer, z } from "alepha";

/**
 * Why the module disabled an endpoint: the receiver answered `410 Gone`
 * (`gone`), it kept failing for the configured number of days (`failing`),
 * or its secret no longer decrypts with `APP_SECRET` (`secret`).
 */
export const webhookDisabledReasonSchema = z.enum([
  "gone",
  "failing",
  "secret",
]);

export type WebhookDisabledReason = Infer<typeof webhookDisabledReasonSchema>;
