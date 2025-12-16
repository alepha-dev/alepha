import { type Static, t } from "alepha";

export const registrationIntentResponseSchema = t.object({
  intentId: t.uuid({
    description: "Unique identifier for the registration intent",
  }),
  expectCaptcha: t.boolean({
    description: "Whether captcha verification is required",
  }),
  expectEmailVerification: t.boolean({
    description: "Whether email verification is required",
  }),
  expectPhoneVerification: t.boolean({
    description: "Whether phone verification is required",
  }),
  expiresAt: t.datetime({
    description: "When the registration intent expires",
  }),
});

export type RegistrationIntentResponse = Static<
  typeof registrationIntentResponseSchema
>;
