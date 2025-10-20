import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const requestVerificationCodeResponseSchema = t.object({
  token: t.string({
    description:
      "The verification token (6-digit code for phone, UUID for email). The caller should send this to the user via their preferred notification method.",
  }),
  codeExpiration: t.int({
    description: "Time in seconds before your verification token expires.",
  }),
  verificationCooldown: t.int({
    description:
      "Cooldown period in seconds before you can request another verification.",
  }),
  maxVerificationAttempts: t.int({
    description:
      "Maximum number of verification attempts allowed before the token is locked.",
  }),
});

export type RequestVerificationResponse = Static<
  typeof requestVerificationCodeResponseSchema
>;
