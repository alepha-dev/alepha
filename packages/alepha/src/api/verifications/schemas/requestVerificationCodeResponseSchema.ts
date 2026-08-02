import type { Infer } from "alepha";
import { z } from "alepha";

export const requestVerificationCodeResponseSchema = z.object({
  token: z
    .string()
    .describe(
      "The verification token (6-digit code for phone, UUID for email). The caller should send this to the user via their preferred notification method.",
    ),
  codeExpiration: z
    .integer()
    .describe("Time in seconds before your verification token expires."),
  verificationCooldown: z
    .integer()
    .describe(
      "Cooldown period in seconds before you can request another verification.",
    ),
  maxVerificationAttempts: z
    .integer()
    .describe(
      "Maximum number of verification attempts allowed before the token is locked.",
    ),
});

export type RequestVerificationResponse = Infer<
  typeof requestVerificationCodeResponseSchema
>;
