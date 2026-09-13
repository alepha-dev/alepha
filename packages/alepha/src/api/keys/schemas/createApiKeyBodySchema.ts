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
  /**
   * Narrow the key to these permissions, below what its roles grant: full
   * `group:name` strings the application registers, never patterns. Omit, or
   * pass `[]`, for a key with everything its roles allow. Each must be one
   * the caller may grant (its own roles and scope), or creation is refused
   * naming it.
   */
  permissions: z.array(z.text()).max(500).optional(),
});
