import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const userQuerySchema = t.extend(pageQuerySchema, {
  email: t.optional(t.string()),
  enabled: t.optional(t.boolean()),
  emailVerified: t.optional(t.boolean()),
  roles: t.optional(t.array(t.string())),
});

export type UserQuery = Static<typeof userQuerySchema>;
