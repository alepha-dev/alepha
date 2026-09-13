import { type Infer, z } from "alepha";

import { apiKeyStatusSchema } from "./apiKeyStatusSchema.ts";

/**
 * One of the caller's own keys, as `GET /api-keys` lists it.
 *
 * Expired and revoked keys are listed too, with their `status`: a key that
 * stopped working is the answer to "why did CI stop", so the list must be
 * able to show it.
 */
export const listApiKeyItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().optional(),
  tokenPrefix: z.string(),
  tokenSuffix: z.string(),
  roles: z.array(z.string()),
  createdAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
  lastUsedIp: z.string().optional(),
  expiresAt: z.datetime().optional(),
  revokedAt: z.datetime().optional(),
  rotatedAt: z.datetime().optional(),
  usageCount: z.integer(),
  status: apiKeyStatusSchema,
});

export type ListApiKeyItem = Infer<typeof listApiKeyItemSchema>;
