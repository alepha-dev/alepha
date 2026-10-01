import { type Infer, z } from "alepha";

/**
 * The durations an API key may be created or rotated with.
 *
 * A duration rather than a date, because nobody picks "the 14th of March" for
 * a CI credential. It is resolved to an instant on the SERVER, against the
 * expiry policy (`apiKeyOptions.maxExpiryDays`), so the policy is a rule and
 * not advice: a client that computed its own date could post anything.
 *
 * `"1y"` is 365 days, so a cap of 365 admits it in every year.
 */
export const apiKeyExpiresInSchema = z
  .enum(["7d", "30d", "60d", "90d", "180d", "1y", "never"])
  .describe("How long the key lives. 'never' is refused under an expiry cap.");

export type ApiKeyExpiresIn = Infer<typeof apiKeyExpiresInSchema>;
