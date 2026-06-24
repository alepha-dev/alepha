import type { Static } from "alepha";
import { z } from "alepha";

/**
 * Response schema for password reset intent creation.
 *
 * Contains the intent ID needed for Phase 2 completion,
 * along with expiration time.
 */
export const passwordResetIntentResponseSchema = z.object({
  intentId: z
    .uuid()
    .describe("Unique identifier for this password reset intent"),
  expiresAt: z.datetime().describe("ISO timestamp when this intent expires"),
});

export type PasswordResetIntentResponse = Static<
  typeof passwordResetIntentResponseSchema
>;
