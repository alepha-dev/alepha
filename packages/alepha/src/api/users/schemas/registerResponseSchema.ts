import type { Infer } from "alepha";
import { z } from "alepha";

import { users } from "../entities/users.ts";

/**
 * Schema for user registration response.
 * Returns the created user without sensitive data.
 */
export const registerResponseSchema = z.object({
  user: users.schema,
});

export type RegisterResponse = Infer<typeof registerResponseSchema>;
