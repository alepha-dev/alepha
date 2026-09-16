import { type Infer, z } from "alepha";

/**
 * Where a key is in its life, derived on read and never stored.
 *
 * - `revoked`: its owner or an admin revoked it. Wins over `expired`: a
 *   revocation is a decision, an expiry only an event.
 * - `expired`: `expiresAt` has passed.
 * - `expiring`: it expires within `apiKeyOptions.expiryWarningDays`.
 * - `active`: none of the above.
 *
 * A stored status would need a job to keep it true, and between two runs of
 * that job the column would be a lie that outlives the key.
 */
export const apiKeyStatusSchema = z
  .enum(["active", "expiring", "expired", "revoked"])
  .describe("Where the key is in its life, derived when it is read.");

export type ApiKeyStatus = Infer<typeof apiKeyStatusSchema>;
