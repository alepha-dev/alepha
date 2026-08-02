import type { Infer } from "alepha";
import { z } from "alepha";

export const resetPasswordRequestSchema = z.object({
  email: z.email().describe("Email address to send password reset link"),
});

export const resetPasswordSchema = z.object({
  token: z.string().describe("Password reset token from email"),
  password: z.string().min(8).describe("New password"),
  confirmPassword: z
    .string()
    .min(8)
    .describe("Confirmation of the new password"),
});

export type ResetPasswordRequest = Infer<typeof resetPasswordRequestSchema>;
export type ResetPasswordInput = Infer<typeof resetPasswordSchema>;
