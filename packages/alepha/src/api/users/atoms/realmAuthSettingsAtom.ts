import { $atom, type Static, t } from "alepha";

/**
 * Tri-state field requirement for realm auth settings.
 *
 * - `"none"`: Field is disabled and not shown.
 * - `"optional"`: Field is shown but not required.
 * - `"required"`: Field is shown and required.
 */
export type FieldRequirement = "none" | "optional" | "required";

const fieldRequirement = (description: string) =>
  t.union([t.const("none"), t.const("optional"), t.const("required")], {
    description,
  });

export const realmAuthSettingsAtom = $atom({
  name: "alepha.api.users.realmAuthSettings",
  schema: t.object({
    // Branding and display settings
    displayName: t.optional(
      t.string({
        description:
          "Display name shown on auth pages (e.g., 'Customer Portal')",
      }),
    ),
    description: t.optional(
      t.string({
        description: "Description shown on auth pages",
      }),
    ),
    logoUrl: t.optional(
      t.string({
        description: "Logo URL for auth pages",
      }),
    ),

    // Auth settings
    registrationAllowed: t.boolean({
      description: "Enable user self-registration",
    }),
    email: fieldRequirement(
      "Email address field requirement for user accounts",
    ),
    username: fieldRequirement("Username field requirement for user accounts"),
    usernameRegExp: t.string({
      description:
        "Regular expression that usernames must match (if username is enabled)",
    }),
    phoneNumber: fieldRequirement(
      "Phone number field requirement for user accounts",
    ),
    verifyEmailRequired: t.boolean({
      description: "Require email verification for user accounts",
    }),
    verifyPhoneRequired: t.boolean({
      description: "Require phone verification for user accounts",
    }),
    firstNameLastName: fieldRequirement(
      "First and last name field requirement for user accounts",
    ),
    resetPasswordAllowed: t.boolean({
      description: "Enable forgot password functionality",
    }),
    adminEmails: t.array(t.email(), {
      description:
        "List of email addresses that are automatically promoted to admin role on login",
    }),
    adminUsernames: t.array(t.text(), {
      description:
        "List of usernames that are automatically promoted to admin role on login",
    }),
    passwordPolicy: t.object({
      minLength: t.integer({
        description: "Minimum password length",
        default: 8,
        minimum: 1,
      }),
      requireUppercase: t.boolean({
        description: "Require at least one uppercase letter",
      }),
      requireLowercase: t.boolean({
        description: "Require at least one lowercase letter",
      }),
      requireNumbers: t.boolean({
        description: "Require at least one number",
      }),
      requireSpecialCharacters: t.boolean({
        description: "Require at least one special character",
      }),
    }),
    loginRateLimit: t.object({
      ipMaxAttempts: t.integer({
        description:
          "Max failed login attempts per IP before temporary lockout",
        default: 15,
        minimum: 1,
      }),
      accountMaxAttempts: t.integer({
        description:
          "Max failed login attempts per account before temporary lockout",
        default: 5,
        minimum: 1,
      }),
      windowMs: t.integer({
        description: "Rate limit window duration in milliseconds",
        default: 15 * 60 * 1000,
        minimum: 1000,
      }),
    }),
  }),
  default: {
    // for a fresh hello world setup, we accept registration and email login
    registrationAllowed: true,
    email: "required" as FieldRequirement,
    username: "none" as FieldRequirement,
    usernameRegExp: "^[a-zA-Z0-9_]{3,30}$",
    phoneNumber: "none" as FieldRequirement,
    verifyEmailRequired: false,
    verifyPhoneRequired: false,
    resetPasswordAllowed: false,
    firstNameLastName: "none" as FieldRequirement,
    adminEmails: [],
    adminUsernames: [],
    // TODO: not implemented yet
    passwordPolicy: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialCharacters: false,
    },
    loginRateLimit: {
      ipMaxAttempts: 15,
      accountMaxAttempts: 5,
      windowMs: 15 * 60 * 1000,
    },
  },
});

export type RealmAuthSettings = Static<typeof realmAuthSettingsAtom.schema>;
