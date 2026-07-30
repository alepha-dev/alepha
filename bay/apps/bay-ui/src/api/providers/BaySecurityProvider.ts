import { $env, z } from "alepha";
import { $realm } from "alepha/api/users";

/**
 * Realm configuration for bay-ui.
 *
 * bay-ui is a control panel for a machine that hosts other people's
 * applications: every action it exposes is root-equivalent in effect. So the
 * realm is deliberately the narrowest thing that still lets one operator log
 * in — credentials only, no social identities, no avatars, no notifications.
 *
 * **Registration is closed by default.** An open sign-up form on an
 * infrastructure panel is a spam vector at best. The bootstrap is two steps and
 * documented in the README: set `BAY_UI_ALLOW_REGISTRATION=1` for the first
 * boot, create the admin account, then unset it.
 *
 * Authorization itself does not depend on that flag: every endpoint requires
 * the `admin` role, and `adminEmails` is what grants it — on login, to the one
 * address the operator declared. An account created by anyone else can do
 * nothing at all.
 */
export class BaySecurityProvider {
  env = $env(
    z.object({
      /**
       * The operator's email. Auto-promoted to `admin` on login.
       */
      BAY_UI_ADMIN_EMAIL: z.email().optional(),

      /**
       * Opens self-registration. Leave unset in normal operation.
       */
      BAY_UI_ALLOW_REGISTRATION: z.boolean().default(false),
    }),
  );

  realm = $realm({
    features: {
      // Everything off: an infra panel needs a login, not a social product.
      apiKeys: false,
      avatars: false,
      audits: true,
      jobs: false,
      notifications: false,
      oauth: false,
    },
    settings: {
      username: "email",
      // Closed unless explicitly opened for the initial bootstrap.
      registrationAllowed: !!this.env.BAY_UI_ALLOW_REGISTRATION,
      // No mail provider is configured, so a reset link would go nowhere and a
      // verification requirement would lock the operator out of their own
      // machine on first boot.
      resetPasswordAllowed: false,
      verifyEmailRequired: false,
      adminEmails: this.env.BAY_UI_ADMIN_EMAIL
        ? [this.env.BAY_UI_ADMIN_EMAIL]
        : [],
    },
    identities: {
      credentials: true,
    },
  });
}
