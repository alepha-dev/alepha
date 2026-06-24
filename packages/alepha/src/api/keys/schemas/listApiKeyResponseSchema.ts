import { z } from "alepha";

export const listApiKeyItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  tokenPrefix: z.string(),
  tokenSuffix: z.string(),
  roles: z.array(z.string()),
  createdAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
  lastUsedIp: z.string().optional(),
  expiresAt: z.datetime().optional(),
  usageCount: z.integer(),
});

export const listApiKeyResponseSchema = z.array(listApiKeyItemSchema);
