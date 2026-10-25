import type { Infer } from "alepha";
import { z } from "alepha";

export const resetPasswordRequestSchema = z.object({
  email: z.email().describe("Email address to send password reset link"),
});

export type ResetPasswordRequest = Infer<typeof resetPasswordRequestSchema>;
