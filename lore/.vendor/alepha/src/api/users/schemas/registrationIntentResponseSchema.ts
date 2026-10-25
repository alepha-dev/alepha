import { type Infer, z } from "alepha";

export const registrationIntentResponseSchema = z.object({
  intentId: z.uuid().describe("Unique identifier for the registration intent"),
  expectCaptcha: z
    .boolean()
    .describe("Whether captcha verification is required"),
  captchaSiteKey: z
    .string()
    .describe(
      "Public site key the client should render (when expectCaptcha is true)",
    )
    .optional(),
  expectEmailVerification: z
    .boolean()
    .describe("Whether email verification is required"),
  expectPhoneVerification: z
    .boolean()
    .describe("Whether phone verification is required"),
  expiresAt: z.datetime().describe("When the registration intent expires"),
});

export type RegistrationIntentResponse = Infer<
  typeof registrationIntentResponseSchema
>;
