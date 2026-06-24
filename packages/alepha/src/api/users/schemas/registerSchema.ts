import type { Static } from "alepha";
import { z } from "alepha";

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/)
    .describe("Username for the new account"),
  email: z.email().describe("Email address for the new account"),
  password: z.string().min(8).describe("Password for the new account"),
  confirmPassword: z.string().min(8).describe("Confirmation of the password"),
  firstName: z.string().max(100).describe("User's first name").optional(),
  lastName: z.string().max(100).describe("User's last name").optional(),
});

export type RegisterInput = Static<typeof registerSchema>;
