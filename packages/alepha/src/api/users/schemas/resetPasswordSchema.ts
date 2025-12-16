import type { Static } from "alepha";
import { t } from "alepha";

export const resetPasswordRequestSchema = t.object({
  email: t.email({
    description: "Email address to send password reset link",
  }),
});

export const resetPasswordSchema = t.object({
  token: t.string({
    description: "Password reset token from email",
  }),
  password: t.string({
    minLength: 8,
    description: "New password",
  }),
  confirmPassword: t.string({
    minLength: 8,
    description: "Confirmation of the new password",
  }),
});

export type ResetPasswordRequest = Static<typeof resetPasswordRequestSchema>;
export type ResetPasswordInput = Static<typeof resetPasswordSchema>;
