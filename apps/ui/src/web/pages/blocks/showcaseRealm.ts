import type { RealmConfig } from "alepha/api/users";

/**
 * A realm the auth screens render against, with no realm behind it.
 *
 * ⚠️ **A plain literal, and it must stay one.** An earlier version built these
 * settings from `realmAuthSettingsAtom.options.default`, which reads better and
 * broke the auth page outright: importing that atom from `alepha/api/users`
 * pulls a server-only export into the browser bundle, and the page died with
 * "SyntaxError: The requested module ... does not provide an export". This file
 * is imported from BOTH sides - the auth page and the showcase realm controller
 * - so it may only contain data.
 *
 * A partial literal is not an option either. The settings object has around
 * twenty required fields, and a short one compiles and then fails response
 * validation with "Invalid input at /settings/email" the moment an `$action`
 * returns it. The values below are the framework's own defaults, captured from
 * `GET /api/realms/config`.
 *
 * `adminEmails` and `adminUsernames` are absent because the public projection
 * omits them: they name the accounts auto-promoted to admin and must never
 * reach an unauthenticated caller.
 */
export const SHOWCASE_REALM: RealmConfig = {
  realmName: "showcase",
  /**
   * Every provider, on purpose. One credential provider renders a form and no
   * divider, which is the least informative version of this screen; three
   * social buttons is what shows the layout doing its job.
   */
  authenticationMethods: [
    { name: "credentials", type: "CREDENTIALS" },
    { name: "github", type: "OAUTH2" },
    { name: "google", type: "OAUTH2" },
    { name: "apple", type: "OAUTH2" },
  ],
  settings: {
    // On, so the login screen shows both its links.
    registrationAllowed: true,
    resetPasswordAllowed: true,
    email: "required",
    username: "none",
    usernameRegExp: "^[a-zA-Z0-9_-]{3,30}$",
    usernameBlocklist: [],
    phoneNumber: "none",
    verifyEmailRequired: false,
    trustProviderEmail: true,
    verifyPhoneRequired: false,
    firstNameLastName: "none",
    captchaRequired: false,
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
      windowMs: 900_000,
    },
    registrationIpMaxAttempts: 10,
    mfa: {
      totp: "disabled",
      emailCode: "disabled",
    },
    refreshToken: {},
  } as RealmConfig["settings"],
};
