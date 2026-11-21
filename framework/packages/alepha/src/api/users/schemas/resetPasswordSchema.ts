import type { Infer } from "alepha";
import { z } from "alepha";

export const resetPasswordRequestSchema = z.object({
  email: z.email().describe("Email address to send the password reset code to"),
});

export type ResetPasswordRequest = Infer<typeof resetPasswordRequestSchema>;
