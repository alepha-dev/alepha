import { t } from "alepha";

export const listApiKeyItemSchema = t.object({
  id: t.uuid(),
  name: t.string(),
  tokenPrefix: t.string(),
  tokenSuffix: t.string(),
  roles: t.array(t.string()),
  createdAt: t.datetime(),
  lastUsedAt: t.optional(t.datetime()),
  lastUsedIp: t.optional(t.string()),
  expiresAt: t.optional(t.datetime()),
  usageCount: t.integer(),
});

export const listApiKeyResponseSchema = t.array(listApiKeyItemSchema);
