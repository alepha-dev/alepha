import type { Static } from "alepha";
import { z } from "alepha";

/**
 * Schema for user registration request body.
 * Password is always required, other fields depend on realm settings.
 */
export const registerRequestSchema = z.object({
  // Password is always required
  password: z.string().min(8).describe("Password for the account"),

  // Identity fields (requirements depend on realm settings)
  username: z
    .string()
    .min(3)
    .describe("Unique username for the account")
    .optional(),

  // Optional contact fields
  email: z
    .string()
    .meta({ format: "email" })
    .describe("User's email address")
    .optional(),
  phoneNumber: z.string().describe("User's phone number").optional(),

  // Optional user profile fields
  firstName: z.string().describe("User's first name").optional(),
  lastName: z.string().describe("User's last name").optional(),
  picture: z.string().describe("User's profile picture URL").optional(),

  // Captcha token — required when the realm has `captchaRequired: true`.
  // Validated at intent creation (before any verification email is sent).
  captchaToken: z
    .string()
    .describe("Captcha response token (if captcha is required)")
    .optional(),
});

export type RegisterRequest = Static<typeof registerRequestSchema>;
