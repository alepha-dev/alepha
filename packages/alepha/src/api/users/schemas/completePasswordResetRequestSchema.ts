import type { Static } from "alepha";
import { z } from "alepha";

/**
 * Request schema for completing a password reset.
 *
 * Requires the intent ID from Phase 1, the verification code,
 * and the new password.
 */
export const completePasswordResetRequestSchema = z.object({
  intentId: z.uuid().describe("The intent ID from createPasswordResetIntent"),
  code: z.string().describe("6-digit verification code sent via email"),
  newPassword: z
    .string()
    .min(8)
    .describe("New password (minimum 8 characters)"),
});

export type CompletePasswordResetRequest = Static<
  typeof completePasswordResetRequestSchema
>;
