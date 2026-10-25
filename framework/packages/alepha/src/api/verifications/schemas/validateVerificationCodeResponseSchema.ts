import type { Infer } from "alepha";
import { z } from "alepha";

export const validateVerificationCodeResponseSchema = z.object({
  ok: z
    .boolean()
    .describe("Indicates whether the verification was successful."),
  alreadyVerified: z
    .boolean()
    .describe("Indicates whether the target was already verified.")
    .optional(),
});

export type ValidateVerificationCodeResponse = Infer<
  typeof validateVerificationCodeResponseSchema
>;
