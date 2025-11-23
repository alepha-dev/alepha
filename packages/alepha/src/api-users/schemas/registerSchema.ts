import type { Static } from "alepha";
import { t } from "alepha";

export const registerSchema = t.object({
  username: t.string({
    minLength: 3,
    maxLength: 20,
    pattern: /^[a-zA-Z0-9_]+$/,
    description: "Username for the new account",
  }),
  email: t.email({
    description: "Email address for the new account",
  }),
  password: t.string({
    minLength: 8,
    description: "Password for the new account",
  }),
  confirmPassword: t.string({
    minLength: 8,
    description: "Confirmation of the password",
  }),
  firstName: t.optional(
    t.string({
      maxLength: 100,
      description: "User's first name",
    }),
  ),
  lastName: t.optional(
    t.string({
      maxLength: 100,
      description: "User's last name",
    }),
  ),
});

export type RegisterInput = Static<typeof registerSchema>;
