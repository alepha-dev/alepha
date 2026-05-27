import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const userQuerySchema = t.extend(pageQuerySchema, {
  /**
   * Free-text search applied (case-insensitive) across `email`,
   * `username`, `firstName`, and `lastName`. Matches with a leading and
   * trailing wildcard, so `?search=foo` finds any user whose email,
   * username, or name contains `foo`.
   */
  search: t.optional(t.string()),
  email: t.optional(t.string()),
  enabled: t.optional(t.boolean()),
  emailVerified: t.optional(t.boolean()),
  roles: t.optional(t.array(t.string())),
});

export type UserQuery = Static<typeof userQuerySchema>;
