import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const userQuerySchema = pageQuerySchema.extend({
  /**
   * Free-text search applied (case-insensitive) across `email`,
   * `username`, `firstName`, and `lastName`. Matches with a leading and
   * trailing wildcard, so `?search=foo` finds any user whose email,
   * username, or name contains `foo`.
   */
  search: z.string().optional(),
  email: z.string().optional(),
  /**
   * Exact match against a set of addresses, for a caller resolving a whole
   * page of contacts at once (the notifications admin does this per page,
   * rather than one request per row).
   *
   * Distinct from {@link email}, which is a single-value `LIKE`.
   */
  emails: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
});

export type UserQuery = Infer<typeof userQuerySchema>;
