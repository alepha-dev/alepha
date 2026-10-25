import { z } from "alepha";

import { apiKeyExpiresInSchema } from "./apiKeyExpiresInSchema.ts";

/**
 * What a rotation may change: only how long the fresh secret lives. It
 * defaults to `apiKeyOptions.defaultExpiresIn`, and obeys `maxExpiryDays`
 * exactly as creation does, or rotating would be the way around the cap.
 */
export const rotateApiKeyBodySchema = z.object({
  expiresIn: apiKeyExpiresInSchema.optional(),
});
