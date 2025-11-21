import { type Static, t } from "alepha";

export const loginSettingsSchema = t.object({
  registrationAllowed: t.optional(
    t.boolean({
      description: "Enable user self-registration",
      default: true,
    }),
  ),
  registrationEmailAsUsername: t.optional(
    t.boolean({
      description: "Use email as username during registration",
      default: false,
    }),
  ),
  resetPasswordAllowed: t.optional(
    t.boolean({
      description: "Enable forgot password functionality",
      default: false,
    }),
  ),
  verifyEmail: t.optional(
    t.boolean({
      description: "Require email verification",
      default: false,
    }),
  ),
  passwordPolicy: t.optional(
    t.object({
      minLength: t.optional(
        t.integer({
          description: "Minimum password length",
          default: 8,
          minimum: 1,
        }),
      ),
      requireUppercase: t.optional(
        t.boolean({
          description: "Require at least one uppercase letter",
          default: true,
        }),
      ),
      requireLowercase: t.optional(
        t.boolean({
          description: "Require at least one lowercase letter",
          default: true,
        }),
      ),
      requireNumbers: t.optional(
        t.boolean({
          description: "Require at least one number",
          default: true,
        }),
      ),
      requireSpecialCharacters: t.optional(
        t.boolean({
          description: "Require at least one special character",
          default: false,
        }),
      ),
    }),
  ),
});

export type LoginSettings = Static<typeof loginSettingsSchema>;
