import { type Infer, z } from "alepha";
import { authenticationProviderSchema } from "alepha/server/auth";

import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";

/**
 * Public projection of the realm auth settings, served unauthenticated on
 * `/realms/config`: an allow-list of what a sign-in, registration or reset
 * page reads. A setting added to the atom stays server-side until it is
 * named here.
 *
 * Left out, among others: `adminEmails` and `adminUsernames` (the accounts
 * promoted to admin), `loginRateLimit` and `registrationIpMaxAttempts` (how
 * much brute force the realm tolerates), `usernameBlocklist`, `defaultRoles`,
 * `trustProviderEmail`, `verifyEmailUrl`, `refreshToken` and
 * `passkeyRelyingParty` (the options a ceremony needs come from its route).
 */
export const publicRealmSettingsSchema = realmAuthSettingsAtom.schema.pick({
  displayName: true,
  description: true,
  logoUrl: true,
  registrationAllowed: true,
  email: true,
  username: true,
  usernameRegExp: true,
  phoneNumber: true,
  firstNameLastName: true,
  verifyEmailRequired: true,
  verifyPhoneRequired: true,
  resetPasswordAllowed: true,
  captchaRequired: true,
  passwordPolicy: true,
  mfa: true,
  passkeys: true,
});

export const realmConfigSchema = z.object({
  settings: publicRealmSettingsSchema,
  realmName: z.string(),
  authenticationMethods: z.array(authenticationProviderSchema),
  captchaSiteKey: z
    .string()
    .describe(
      "Public site key for the captcha widget (when settings.captchaRequired is true)",
    )
    .optional(),
});

export type RealmConfig = Infer<typeof realmConfigSchema>;
