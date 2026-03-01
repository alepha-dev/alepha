export const apiAppSecurityTs = (opts: { adminEmail?: string } = {}) => {
  const adminEmailsValue = opts.adminEmail ? `["${opts.adminEmail}"]` : "[]";

  return `
import { $realm } from "alepha/api/users";

export class AppSecurity {
  users = $realm({
    settings: {
      // Auto-promote these users to admin on login
      adminEmails: ${adminEmailsValue},
      adminUsernames: [],

      // Registration & login options
      registrationAllowed: true,
      email: "required",
      username: "none",
      phoneNumber: "none",

      // Verification (requires notifications feature)
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      resetPasswordAllowed: false,
    },
    features: {
      // Enable additional features
      notifications: false,
      audits: false,
      apiKeys: false,
      sessionPurge: false,
      avatars: false,
      parameters: false,
    },
    identities: {
      // Enable authentication providers
      credentials: true,
      // google: true,
      // github: true,
    },
  });
}
`.trim();
};
