import type { Static } from "alepha";
import { t } from "alepha";

export const validateVerificationCodeResponseSchema = t.object({
  ok: t.boolean({
    description: "Indicates whether the verification was successful.",
  }),
  alreadyVerified: t.optional(
    t.boolean({
      description: "Indicates whether the target was already verified.",
    }),
  ),
});

export type ValidateVerificationCodeResponse = Static<
  typeof validateVerificationCodeResponseSchema
>;
