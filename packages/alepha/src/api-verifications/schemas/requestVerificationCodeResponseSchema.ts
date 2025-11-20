import type { Static } from "alepha";
import { t } from "alepha";

export const requestVerificationCodeResponseSchema = t.object({
  token: t.string({
    description:
      "The verification token (6-digit code for phone, UUID for email). The caller should send this to the user via their preferred notification method.",
  }),
  codeExpiration: t.integer({
    description: "Time in seconds before your verification token expires.",
  }),
  verificationCooldown: t.integer({
    description:
      "Cooldown period in seconds before you can request another verification.",
  }),
  maxVerificationAttempts: t.integer({
    description:
      "Maximum number of verification attempts allowed before the token is locked.",
  }),
});

export type RequestVerificationResponse = Static<
  typeof requestVerificationCodeResponseSchema
>;
