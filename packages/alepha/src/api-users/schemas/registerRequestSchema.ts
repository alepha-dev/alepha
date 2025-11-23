import type { Static } from "alepha";
import { t } from "alepha";

/**
 * Schema for user registration request body.
 * Password is always required, other fields depend on realm settings.
 */
export const registerRequestSchema = t.object({
  // Password is always required
  password: t.string({
    minLength: 8,
    description: "Password for the account",
  }),

  // Identity fields (requirements depend on realm settings)
  username: t.optional(
    t.string({
      minLength: 3,
      description: "Unique username for the account",
    }),
  ),

  // Optional contact fields
  email: t.optional(
    t.string({
      format: "email",
      description: "User's email address",
    }),
  ),
  phoneNumber: t.optional(
    t.string({
      description: "User's phone number",
    }),
  ),

  // Optional user profile fields
  firstName: t.optional(
    t.string({
      description: "User's first name",
    }),
  ),
  lastName: t.optional(
    t.string({
      description: "User's last name",
    }),
  ),
  picture: t.optional(
    t.string({
      description: "User's profile picture URL",
    }),
  ),
});

export type RegisterRequest = Static<typeof registerRequestSchema>;
