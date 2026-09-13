import { z } from "alepha";

import { apiKeyExpiresInSchema } from "./apiKeyExpiresInSchema.ts";

export const createApiKeyBodySchema = z.object({
  name: z.text({ minLength: 1, maxLength: 100 }),
  description: z.text({ maxLength: 500 }).optional(),
  /**
   * How long the key lives, resolved on the server. Prefer it to `expiresAt`:
   * it is what the expiry policy is expressed in.
   */
  expiresIn: apiKeyExpiresInSchema.optional(),
  /**
   * An exact expiry, for programmatic callers. Checked against the same
   * policy as `expiresIn`; pass one or the other.
   */
  expiresAt: z.datetime().optional(),
});
