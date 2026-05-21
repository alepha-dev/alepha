/**
 * Realm provider scaffolded by `alepha init --saas`.
 *
 * Minimal hello-world setup: credentials login with email, admins seeded
 * from the `ADMIN_EMAILS` env var, and an `admin:ui` permission used by the
 * AppRouter to gate `/admin/*`. The default `admin` role grants `*` (so it
 * inherits `admin:ui`); the default `user` role excludes `admin:*` (so
 * non-admins get a 403 before the shell renders).
 *
 * Admin emails are read from the environment, never hard-coded — they are
 * deployment config (different per environment, and personal data) and
 * belong in `.env`, not in committed source.
 */
export const saasRealmProviderTs = () => {
  return `import { $env, t } from "alepha";
import { $realm } from "alepha/api/users";
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

  /**
   * Admin emails — set \`ADMIN_EMAILS\` in \`.env\` (comma-separated for
   * several). Keep emails out of source: they are config, not code.
   */
  protected readonly env = $env(
    t.object({
      ADMIN_EMAILS: t.text({ default: "" }),
    }),
  );

  realm = $realm({
    settings: {
      adminEmails: this.env.ADMIN_EMAILS.split(",")
        .map((email) => email.trim())
        .filter(Boolean),
    },
    identities: {
      credentials: true,
    },
  });
}
`;
};
