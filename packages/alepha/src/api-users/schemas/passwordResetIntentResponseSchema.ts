import type { Static } from "alepha";
import { t } from "alepha";

/**
 * Response schema for password reset intent creation.
 *
 * Contains the intent ID needed for Phase 2 completion,
 * along with expiration time.
 */
export const passwordResetIntentResponseSchema = t.object({
  intentId: t.uuid({
    description: "Unique identifier for this password reset intent",
  }),
  expiresAt: t.datetime({
    description: "ISO timestamp when this intent expires",
  }),
});

export type PasswordResetIntentResponse = Static<
  typeof passwordResetIntentResponseSchema
>;
