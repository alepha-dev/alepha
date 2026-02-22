import { t } from "alepha";
import { $parameter } from "alepha/api/parameters";
import { $realm } from "alepha/api/users";

export class AppSecurity {
  users = $realm({
    settings: {
      // Auto-promote these users to admin on login
      adminEmails: ["ni.foures@gmail.com"],
      adminUsernames: [],

      // Registration & login options
      registrationAllowed: true,
      emailEnabled: true,
      emailRequired: true,
      usernameEnabled: false,
      usernameRequired: false,
      phoneEnabled: false,
      phoneRequired: false,

      // Verification (requires notifications feature)
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      resetPasswordAllowed: false,
    },
    features: {
      // Enable additional features
      notifications: true,
      audits: true,
      apiKeys: true,
      jobs: true,
      files: true,
      parameters: true,
    },
    identities: {
      // Enable authentication providers
      credentials: true,
      // google: true,
      // github: true,
    },
  });

  config = $parameter({
    name: "app.security",
    description: "Security description",
    schema: t.object({
      jwtSecret: t.string(),
    }),
    default: {
      jwtSecret: "CHANGE_ME",
    },
  });
}
