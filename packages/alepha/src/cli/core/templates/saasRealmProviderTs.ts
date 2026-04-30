export interface SaasRealmProviderOptions {
  /**
   * Email seeded as the default admin when the `ADMIN_EMAIL` env var isn't set.
   * Detected from `git config user.email` at init time; falls through to
   * `admin@example.com` if git isn't configured.
   */
  adminEmail?: string;
}

/**
 * Realm provider scaffolded by `alepha init --saas`.
 *
 * - Reads `ADMIN_EMAIL` from env so each environment can pick its own admin.
 * - Falls back to the developer's git email (captured at scaffold time) so the
 *   freshly-initialized project already has a valid admin without any manual
 *   wiring.
 * - Enables the realm features that the auth + admin UI expects: notifications
 *   (verification + password reset emails), apiKeys (admin API key panel),
 *   audits (admin audit log), and jobs (session purge cron).
 */
export const saasRealmProviderTs = (options: SaasRealmProviderOptions = {}) => {
  const adminEmail = options.adminEmail ?? "admin@example.com";
  return `import { $env, t } from "alepha";
import { $realm } from "alepha/api/users";

export class RealmProvider {
  env = $env(
    t.object({
      ADMIN_EMAIL: t.optional(t.email()),
    }),
  );

  // Seeded with your git email at \`alepha init --saas\` time. Override per
  // environment by exporting ADMIN_EMAIL in your \`.env\` (or platform secrets).
  protected readonly defaultAdminEmail = ${JSON.stringify(adminEmail)};

  realm = $realm({
    features: {
      apiKeys: true,
      audits: true,
      jobs: true,
      notifications: true,
    },
    settings: {
      username: "required",
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      adminEmails: [this.env.ADMIN_EMAIL ?? this.defaultAdminEmail],
    },
    identities: {
      credentials: true,
    },
  });
}
`;
};
