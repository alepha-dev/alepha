import { t } from "alepha";

export const createApiKeyBodySchema = t.object({
  name: t.text({ minLength: 1, maxLength: 100 }),
  description: t.optional(t.text({ maxLength: 500 })),
  expiresAt: t.optional(t.datetime()),
});
