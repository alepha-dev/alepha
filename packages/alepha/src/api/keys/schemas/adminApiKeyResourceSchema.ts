import { t } from "alepha";

export const adminApiKeyResourceSchema = t.object({
  id: t.uuid(),
  userId: t.uuid(),
  name: t.string(),
  description: t.optional(t.string()),
  tokenPrefix: t.string(),
  tokenSuffix: t.string(),
  roles: t.array(t.string()),
  createdAt: t.datetime(),
  lastUsedAt: t.optional(t.datetime()),
  lastUsedIp: t.optional(t.string()),
  expiresAt: t.optional(t.datetime()),
  revokedAt: t.optional(t.datetime()),
  usageCount: t.integer(),
});
