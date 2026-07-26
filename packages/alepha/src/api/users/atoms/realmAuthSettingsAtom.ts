import { $atom, type Static, z } from "alepha";

/**
 * Tri-state field requirement for realm auth settings.
 *
 * - `"none"`: Field is disabled and not shown.
 * - `"optional"`: Field is shown but not required.
 * - `"required"`: Field is shown and required.
 */
export type FieldRequirement = "none" | "optional" | "required";

const fieldRequirement = (description: string) =>
  z
    .union([z.const("none"), z.const("optional"), z.const("required")])
    .describe(description);

/**
 * Username-specific field requirement, extending {@link FieldRequirement}
 * with an additional auto-derivation mode.
 *
 * - `"none"` / `"optional"` / `"required"`: same as {@link FieldRequirement}.
 * - `"email"`: Field is hidden in the registration UI and the value is
 *   auto-derived from the user's email at signup. Same handling on
 *   credentials and OAuth flows. See `UsernameSlugger` for the rule and
 *   collision behavior.
 */
export type UsernameFieldRequirement = FieldRequirement | "email";

const usernameFieldRequirement = (description: string) =>
  z
    .union([
      z.const("none"),
      z.const("optional"),
      z.const("required"),
      z.const("email"),
    ])
    .describe(description);

/**
 * Full realm auth configuration — the server's view.
 *
 * `serverOnly` because this is the unredacted record: `adminEmails` and
 * `adminUsernames` are the accounts auto-promoted to admin on login, and
 * `loginRateLimit` / `registrationIpMaxAttempts` describe exactly how much
 * brute force the realm tolerates. The browser gets the deliberately narrowed
 * `publicRealmSettingsSchema` over `/realms/config` instead — this atom is
 * never part of the hydration payload, and DevTools redacts its value.
 */
export const realmAuthSettingsAtom = $atom({
  name: "alepha.api.users.realmAuthSettings",
  schema: z.object({
    // Branding and display settings
    displayName: z
      .string()
      .describe("Display name shown on auth pages (e.g., 'Customer Portal')")
      .optional(),
    description: z
      .string()
      .describe("Description shown on auth pages")
      .optional(),
    logoUrl: z.string().describe("Logo URL for auth pages").optional(),

    // Auth settings
    registrationAllowed: z.boolean().describe("Enable user self-registration"),
    email: fieldRequirement(
      "Email address field requirement for user accounts",
    ),
    username: usernameFieldRequirement(
      "Username field requirement for user accounts",
    ),
    usernameRegExp: z
      .string()
      .describe(
        "Regular expression that usernames must match (if username is enabled)",
      ),
    usernameBlocklist: z
      .array(z.text())
      .describe(
        "Usernames that the slugger / manual registration must reject. " +
          "Default empty so apps can register `admin`/`root`/`me`/etc. if " +
          "they want; populate it explicitly for handles you want to keep " +
          "off-limits.",
      ),
    phoneNumber: fieldRequirement(
      "Phone number field requirement for user accounts",
    ),
    verifyEmailRequired: z
      .boolean()
      .describe("Require email verification for user accounts"),
    verifyPhoneRequired: z
      .boolean()
      .describe("Require phone verification for user accounts"),
    firstNameLastName: fieldRequirement(
      "First and last name field requirement for user accounts",
    ),
    resetPasswordAllowed: z
      .boolean()
      .describe("Enable forgot password functionality"),
    captchaRequired: z
      .boolean()
      .describe(
        "Require captcha verification on registration (needs a CaptchaProvider registered, e.g. TurnstileCaptchaProvider)",
      ),
    adminEmails: z
      .array(z.email())
      .describe(
        "List of email addresses that are automatically promoted to admin role on login",
      ),
    adminUsernames: z
      .array(z.text())
      .describe(
        "List of usernames that are automatically promoted to admin role on login",
      ),
    defaultRoles: z
      .array(z.string())
      .describe("Default roles assigned to newly registered users"),
    verifyEmailUrl: z
      .string()
      .describe(
        "Base URL for email verification links (used when verification method is 'link'). Token and email are appended as query params.",
      )
      .optional(),
    passwordPolicy: z.object({
      minLength: z
        .integer()
        .min(1)
        .describe("Minimum password length")
        .default(8),
      requireUppercase: z
        .boolean()
        .describe("Require at least one uppercase letter"),
      requireLowercase: z
        .boolean()
        .describe("Require at least one lowercase letter"),
      requireNumbers: z.boolean().describe("Require at least one number"),
      requireSpecialCharacters: z
        .boolean()
        .describe("Require at least one special character"),
    }),
    loginRateLimit: z.object({
      ipMaxAttempts: z
        .integer()
        .min(1)
        .describe("Max failed login attempts per IP before temporary lockout")
        .default(15),
      accountMaxAttempts: z
        .integer()
        .min(1)
        .describe(
          "Max failed login attempts per account before temporary lockout",
        )
        .default(5),
      windowMs: z
        .integer()
        .min(1000)
        .describe("Rate limit window duration in milliseconds")
        .default(15 * 60 * 1000),
    }),
    registrationIpMaxAttempts: z
      .integer()
      .min(1)
      .describe(
        "Max registration attempts per IP before temporary lockout. Default 10 protects against signup abuse; raise it in dev/e2e environments where a single localhost IP spawns many test users.",
      )
      .default(10),
    refreshToken: z.object({
      expirationIdle: z
        .integer()
        .min(1000)
        .describe(
          "Maximum time in milliseconds a refresh token may stay unused before being invalidated. " +
            "When set, sessions whose last refresh is older than this window are rejected and deleted, " +
            "even if the absolute `expiresAt` has not been reached. Recommended for SaaS auth posture " +
            "(SOC2/ISO27001). Leave undefined to disable idle invalidation (default).",
        )
        .optional(),
    }),
  }),
  default: {
    // for a fresh hello world setup, we accept registration and email login
    registrationAllowed: true,
    email: "required" as FieldRequirement,
    username: "none" as UsernameFieldRequirement,
    // Allow hyphens by default so the UsernameSlugger output (`ni-foures-testkv`)
    // matches without app overrides. Existing `[a-zA-Z0-9_]` usernames remain
    // valid because the new pattern is a strict superset.
    usernameRegExp: "^[a-zA-Z0-9_-]{3,30}$",
    usernameBlocklist: [] as string[],
    phoneNumber: "none" as FieldRequirement,
    verifyEmailRequired: false,
    verifyPhoneRequired: false,
    resetPasswordAllowed: false,
    captchaRequired: false,
    firstNameLastName: "none" as FieldRequirement,
    adminEmails: [],
    adminUsernames: [],
    defaultRoles: ["user"],
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
    registrationIpMaxAttempts: 10,
    refreshToken: {
      // expirationIdle: undefined — opt-in
    },
  },
  serverOnly: true,
});

export type RealmAuthSettings = Static<typeof realmAuthSettingsAtom.schema>;
