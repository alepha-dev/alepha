import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const identityQuerySchema = t.extend(pageQuerySchema, {
  userId: t.optional(t.uuid()),
  provider: t.optional(t.string()),
});

export type IdentityQuery = Static<typeof identityQuerySchema>;
