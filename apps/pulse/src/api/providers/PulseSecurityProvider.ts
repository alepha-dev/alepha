import { $env, z } from "alepha";
import { $realm } from "alepha/api/users";

/**
 * Realm configuration for Pulse.
 *
 * Username and password, no email, no self-registration — the same shape as
 * bay-admin's, and for the same reason: there is no mail provider, so an email
 * field would promise account recovery it cannot deliver.
 *
 * ⚠️ Placeholder. Pulse has no bootstrap yet, so nobody can sign in. Finish
 * this with the rest of the app — see `TODO.md`.
 */
export class PulseSecurityProvider {
  env = $env(
    z.object({
      PULSE_ADMIN_USERNAME: z.text({ default: "admin" }),
    }),
  );

  realm = $realm({
    features: {
      apiKeys: true,
      avatars: false,
      audits: true,
      jobs: false,
      notifications: false,
      oauth: false,
    },
    settings: {
      username: "required",
      email: "none",
      registrationAllowed: false,
      resetPasswordAllowed: false,
      verifyEmailRequired: false,
      adminUsernames: this.env.PULSE_ADMIN_USERNAME.split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    },
    identities: { credentials: true },
  });
}
