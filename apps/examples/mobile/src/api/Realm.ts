import { $env, z } from "alepha";
import { $realm } from "alepha/api/users";
import { $permission } from "alepha/security";

export class Realm {
  /**
   * Empty by default so a deploy that forgets ADMIN_EMAIL promotes nobody,
   * rather than promoting whoever registers first.
   */
  protected readonly env = $env(
    z.object({
      ADMIN_EMAIL: z.text({
        default: "",
        description:
          "Address promoted to admin on first registration. Set per environment.",
      }),
    }),
  );

  /**
   * AdminRouter's /admin layout is gated on exactly this permission. The
   * default `admin` role holds `*`, so it inherits it; nobody else does.
   */
  adminUi = $permission({
    group: "admin",
    name: "ui",
    description: "Access to the admin UI shell",
  });

  realm = $realm({
    settings: {
      displayName: "mobile",

      /**
       * The first registration matching one of these addresses is promoted
       * to admin — that is how the first admin account is created. Set
       * ADMIN_EMAIL in .env (already done for you locally) and in each
       * deployed environment.
       */
      adminEmails: this.env.ADMIN_EMAIL ? [this.env.ADMIN_EMAIL] : [],

      registrationAllowed: true,
      email: "required",
      username: "optional",
      defaultRoles: ["user"],

      /**
       * All three need to send a code, so they stay off until
       * `features.notifications` is on and a mail provider is configured —
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
       * Backed by the database alone. The rest need a mailer, a bucket or
       * more setup: notifications a mail provider, avatars a bucket,
       * parameters and oauth their own configuration, so turn one on once
       * you have wired it. The matching admin and account screens appear on
       * their own: each page resolves its action against /api/_links and
       * hides when it is absent. Audits and the session purge are not
       * features and always run.
       */
      apiKeys: true,
    },
  });
}
