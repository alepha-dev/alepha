export interface ApiRealmTsOptions {
  appName?: string;
}

/**
 * The `$realm` behind the saas preset's identity surface.
 *
 * Only features that need nothing but the database are on. `notifications`
 * is the reason the file reads more conservatively than it looks: with it
 * off, `$realm` *forces* `verifyEmailRequired`, `verifyPhoneRequired` and
 * `resetPasswordAllowed` to false, because each of them can only complete by
 * sending a code. Scaffolding them as `true` would produce a file whose
 * settings the framework silently overrides — so they are written as `false`
 * with the one instruction that changes them.
 *
 * `adminEmails` is empty on purpose. A scaffolded placeholder address is a
 * real address someone else can register, and the promotion is automatic.
 */
export const apiRealmTs = (options: ApiRealmTsOptions = {}) => {
  const { appName = "app" } = options;

  return `
import { $realm } from "alepha/api/users";
import { $permission } from "alepha/security";

export class Realm {
  /**
   * AdminRouter's /admin layout is gated on exactly this permission. The
   * default \`admin\` role holds \`*\`, so it inherits it; nobody else does.
   */
  adminUi = $permission({
    group: "admin",
    name: "ui",
    description: "Access to the admin UI shell",
  });

  realm = $realm({
    settings: {
      displayName: "${appName}",

      /**
       * The first registration matching one of these addresses is promoted
       * to admin — that is how the first admin account is created, so put
       * your own address here before registering.
       */
      adminEmails: [],

      registrationAllowed: true,
      email: "required",
      username: "optional",
      defaultRoles: ["user"],

      /**
       * All three need to send a code, so they stay off until
       * \`features.notifications\` is on and a mail provider is configured —
       * $realm forces them to false otherwise.
       */
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      resetPasswordAllowed: false,
    },
    identities: {
      credentials: true,
    },
    features: {
      /**
       * Everything here is backed by the database alone. The rest — jobs,
       * notifications, avatars, parameters, oauth — needs a queue, a mailer
       * or a bucket, so turn one on once you have wired its provider. The
       * matching admin and account screens appear on their own: each page
       * resolves its action against /api/_links and hides when it is absent.
       */
      audits: true,
      apiKeys: true,
    },
  });
}
`.trim();
};
