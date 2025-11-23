import type { Static } from "alepha";
import { t } from "alepha";
import { users } from "../entities/users.ts";

/**
 * Schema for user registration response.
 * Returns the created user without sensitive data.
 */
export const registerResponseSchema = t.object({
  user: users.schema,
});

export type RegisterResponse = Static<typeof registerResponseSchema>;
