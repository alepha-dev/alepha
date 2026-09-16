import { type Infer, z } from "alepha";

import { adminApiKeyOwnerSchema } from "./adminApiKeyOwnerSchema.ts";
import { apiKeyStatusSchema } from "./apiKeyStatusSchema.ts";

export const adminApiKeyResourceSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  user: adminApiKeyOwnerSchema.optional(),
  name: z.string(),
  description: z.string().optional(),
  tokenPrefix: z.string(),
  tokenSuffix: z.string(),
  roles: z.array(z.string()),
  /**
   * The key's permission scope. Empty is everything its roles allow.
   */
  permissions: z.array(z.string()),
  /**
   * The client addresses and CIDR ranges the key may be used from. Empty is
   * from anywhere. Read-only: set at creation, kept by a rotation.
   */
  ipAllowlist: z.array(z.string()),
  createdAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
  lastUsedIp: z.string().optional(),
  expiresAt: z.datetime().optional(),
  revokedAt: z.datetime().optional(),
  rotatedAt: z.datetime().optional(),
  usageCount: z.integer(),
  status: apiKeyStatusSchema,
});

export type AdminApiKeyResource = Infer<typeof adminApiKeyResourceSchema>;
