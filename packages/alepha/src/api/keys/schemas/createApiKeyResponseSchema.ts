import { t } from "alepha";

export const createApiKeyResponseSchema = t.object({
  id: t.uuid(),
  name: t.string(),
  token: t.string(),
  tokenSuffix: t.string(),
  roles: t.array(t.string()),
  createdAt: t.datetime(),
  expiresAt: t.optional(t.datetime()),
});
