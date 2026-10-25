import { type Infer, z } from "alepha";

export const completeRegistrationRequestSchema = z.object({
  intentId: z
    .uuid()
    .describe("The registration intent ID from the first phase"),
  emailCode: z
    .string()
    .describe("Email verification code (if email verification required)")
    .optional(),
  phoneCode: z
    .string()
    .describe("Phone verification code (if phone verification required)")
    .optional(),
  captchaToken: z
    .string()
    .describe("Captcha token (if captcha required)")
    .optional(),
});

export type CompleteRegistrationRequest = Infer<
  typeof completeRegistrationRequestSchema
>;
