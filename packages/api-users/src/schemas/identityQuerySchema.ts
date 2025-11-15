import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { pageQuerySchema } from "@alepha/orm";

export const identityQuerySchema = t.extend(pageQuerySchema, {
  userId: t.optional(t.uuid()),
  provider: t.optional(t.string()),
});

export type IdentityQuery = Static<typeof identityQuerySchema>;
