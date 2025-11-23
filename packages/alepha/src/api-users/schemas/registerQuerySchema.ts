import type { Static } from "alepha";
import { t } from "alepha";

/**
 * Schema for user registration query parameters.
 * Allows specifying a custom user realm.
 */
export const registerQuerySchema = t.object({
  userRealmName: t.optional(
    t.text({
      description:
        "The user realm to register the user in (defaults to 'default')",
    }),
  ),
});

export type RegisterQuery = Static<typeof registerQuerySchema>;
