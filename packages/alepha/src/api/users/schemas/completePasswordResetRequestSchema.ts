import type { Static } from "alepha";
import { t } from "alepha";

/**
 * Request schema for completing a password reset.
 *
 * Requires the intent ID from Phase 1, the verification code,
 * and the new password.
 */
export const completePasswordResetRequestSchema = t.object({
  intentId: t.uuid({
    description: "The intent ID from createPasswordResetIntent",
  }),
  code: t.string({
    description: "6-digit verification code sent via email",
  }),
  newPassword: t.string({
    minLength: 8,
    description: "New password (minimum 8 characters)",
  }),
});

export type CompletePasswordResetRequest = Static<
  typeof completePasswordResetRequestSchema
>;
