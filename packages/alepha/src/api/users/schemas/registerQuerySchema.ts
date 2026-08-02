import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * Schema for user registration query parameters.
 * Allows specifying a custom user realm.
 */
export const registerQuerySchema = z.object({
  userRealmName: z
    .text({
      description:
        "The user realm to register the user in (defaults to 'default')",
    })
    .optional(),
});

export type RegisterQuery = Infer<typeof registerQuerySchema>;
