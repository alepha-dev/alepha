import { $atom, type Static, t } from "alepha";

export const realmAuthSettingsAtom = $atom({
  name: "alepha.api.users.realmAuthSettings",
  schema: t.object({
    registrationAllowed: t.boolean({
      description: "Enable user self-registration",
    }),
    emailEnabled: t.boolean({
      description: "Enable email address as a login/registration credential",
    }),
    emailRequired: t.boolean({
      description: "Require email address for user accounts",
    }),
    usernameEnabled: t.boolean({
      description: "Enable username as a login/registration credential",
    }),
    usernameRequired: t.boolean({
      description: "Require username for user accounts",
    }),
    phoneEnabled: t.boolean({
      description: "Enable phone number as a login/registration credential",
    }),
    phoneRequired: t.boolean({
      description: "Require phone number for user accounts",
    }),
    verifyEmailRequired: t.boolean({
      description: "Require email verification for user accounts",
    }),
    verifyPhoneRequired: t.boolean({
      description: "Require phone verification for user accounts",
    }),
    firstNameLastNameEnabled: t.boolean({
      description: "Enable first and last name for user accounts",
    }),
    firstNameLastNameRequired: t.boolean({
      description: "Require first and last name for user accounts",
    }),
    resetPasswordAllowed: t.boolean({
      description: "Enable forgot password functionality",
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
  }),
  default: {
    registrationAllowed: true,
    emailEnabled: true,
    emailRequired: true,
    usernameEnabled: true,
    usernameRequired: false,
    phoneEnabled: false,
    phoneRequired: false,
    verifyEmailRequired: false,
    verifyPhoneRequired: false,
    resetPasswordAllowed: false,
    firstNameLastNameEnabled: false,
    firstNameLastNameRequired: false,
    passwordPolicy: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialCharacters: false,
    },
  },
});

export type RealmAuthSettings = Static<typeof realmAuthSettingsAtom.schema>;
