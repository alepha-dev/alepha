import { $env, z } from "alepha";
import { $realm } from "alepha/api/users";

/**
 * Realm configuration for bay-admin.
 *
 * bay-admin is a control panel for a machine that hosts other people's
 * applications: every action it exposes is root-equivalent in effect. So the
 * realm is the narrowest thing that still lets one operator log in —
 * a username and a password, nothing else.
 *
 * **No email.** Not a simplification for its own sake: an email field on a
 * realm with no mail provider is a field that promises password recovery and
 * account verification, and delivers neither. Better to have no address than
 * one nobody can send to.
 *
 * **Registration is closed, permanently.** There is no sign-up form. The one
 * account is created at first boot by {@link BootstrapService}; a second
 * operator is added by an existing one. An open form on an infrastructure
 * panel is a spam vector at best.
 */
export class BaySecurityProvider {
  env = $env(
    z.object({
      /**
       * Usernames auto-promoted to `admin` on login, comma-separated.
       *
       * A list rather than one name: a machine can have more than one person
       * responsible for it, and the alternative — swapping a single value —
       * takes admin away from whoever held it, which is exactly the wrong
       * thing to do to add a colleague.
       */
      BAY_ADMIN_USERNAME: z.text({ default: "admin" }),
    }),
  );

  realm = $realm({
    features: {
      // Needed by `alepha platform up`: a CLI has no browser to complete an
      // interactive login, and CI has nobody at the keyboard at all.
      apiKeys: true,
      // Everything else off: an infra panel needs a login, not a social
      // product.
      avatars: false,
      audits: true,
      jobs: false,
      notifications: false,
      // The device grant lives in this module: `alepha platform auth login`
      // needs an authorization server to talk to.
      oauth: true,
    },
    settings: {
      username: "required",
      // No email at all. See the class comment.
      email: "none",
      // Closed. The bootstrap account is created server-side at first boot.
      registrationAllowed: false,
      // Both would need a mail provider, and there is no address to send to.
      // Recovery is `bay-admin reset-password` on the host, which is the right
      // level of proof for a machine you must already be able to log into.
      resetPasswordAllowed: false,
      verifyEmailRequired: false,
      adminUsernames: this.env.BAY_ADMIN_USERNAME.split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    },
    identities: {
      credentials: true,
    },
  });
}
