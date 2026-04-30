export interface SaasRealmProviderOptions {
  /**
   * Email seeded as the default admin. Detected from `git config user.email`
   * at init time; falls through to `admin@example.com` if git isn't configured.
   */
  adminEmail?: string;
}

/**
 * Realm provider scaffolded by `alepha init --saas`.
 *
 * Minimal hello-world setup: credentials login with email, one admin seeded
 * with the developer's git email at scaffold time, and an `admin:ui`
 * permission used by the AppRouter to gate `/admin/*`. The default `admin`
 * role grants `*` (so it inherits `admin:ui`); the default `user` role
 * excludes `admin:*` (so non-admins get a 403 before the shell renders).
 *
 * Add `$env`, more permissions, or stricter settings as the project grows.
 */
export const saasRealmProviderTs = (options: SaasRealmProviderOptions = {}) => {
  const adminEmail = options.adminEmail ?? "admin@example.com";
  return `import { $realm } from "alepha/api/users";
import { $permission } from "alepha/security";

export class RealmProvider {
  /**
   * Permission required to open the admin UI. Wired into AppRouter.adminLayout
   * via \`$secure({ permissions: ["admin:ui"] })\`.
   */
  adminUi = $permission({
    group: "admin",
    name: "ui",
    description: "Access to the admin UI shell",
  });

  realm = $realm({
    settings: {
      adminEmails: [${JSON.stringify(adminEmail)}],
    },
    identities: {
      credentials: true,
    },
  });
}
`;
};
