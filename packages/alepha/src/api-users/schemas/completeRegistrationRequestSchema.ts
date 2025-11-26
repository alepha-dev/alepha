import { type Static, t } from "alepha";

export const completeRegistrationRequestSchema = t.object({
  intentId: t.uuid({
    description: "The registration intent ID from the first phase",
  }),
  emailCode: t.optional(
    t.string({
      description: "Email verification code (if email verification required)",
    }),
  ),
  phoneCode: t.optional(
    t.string({
      description: "Phone verification code (if phone verification required)",
    }),
  ),
  captchaToken: t.optional(
    t.string({
      description: "Captcha token (if captcha required)",
    }),
  ),
});

export type CompleteRegistrationRequest = Static<
  typeof completeRegistrationRequestSchema
>;
