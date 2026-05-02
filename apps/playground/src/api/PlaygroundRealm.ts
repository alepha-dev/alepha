import { $realm } from "alepha/api/users";
import { $permission } from "alepha/security";

/**
 * Playground realm — every $realm feature toggled on so the playground
 * exercises the full Alepha auth surface (users, sessions, API keys,
 * audits, parameters, avatar uploads, password resets, email verification).
 *
 * `admin@alepha.dev` is seeded as admin via `adminEmails`: the first
 * registration with that address is auto-promoted. Any other email becomes
 * a plain user (default role `user`).
 *
 * `admin:ui` is the permission required to open `/admin/*`. The default
 * admin role gets `*` so it inherits this.
 */
export class PlaygroundRealm {
  adminUi = $permission({
    group: "admin",
    name: "ui",
    description: "Access to the admin UI shell",
  });

  realm = $realm({
    settings: {
      displayName: "Alepha Playground",
      description: "Showcase realm — every feature enabled.",
      adminEmails: ["admin@alepha.dev"],
      registrationAllowed: true,
      email: "required",
      username: "optional",
      firstNameLastName: "optional",
      phoneNumber: "none",
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      resetPasswordAllowed: true,
      captchaRequired: false,
      defaultRoles: ["user"],
      passwordPolicy: {
        minLength: 8,
        requireUppercase: false,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecialCharacters: false,
      },
      loginRateLimit: {
        ipMaxAttempts: 100,
        accountMaxAttempts: 100,
        windowMs: 15 * 60 * 1000,
      },
    },
    identities: {
      credentials: true,
    },
    features: {
      jobs: true,
      notifications: true,
      apiKeys: true,
      parameters: true,
      avatars: true,
      audits: true,
    },
  });
}
