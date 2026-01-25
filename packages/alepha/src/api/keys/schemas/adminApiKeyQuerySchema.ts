import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const adminApiKeyQuerySchema = t.extend(pageQuerySchema, {
  userId: t.optional(t.uuid()),
  includeRevoked: t.optional(t.boolean()),
});
