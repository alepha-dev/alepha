export interface EnvLocalOptions {
  /**
   * Address the first registration is promoted to admin with. Resolved by
   * {@link ProjectScaffolder.resolveAdminEmail} from `git config user.email`,
   * falling back to a placeholder.
   */
  adminEmail: string;
}

/**
 * The generated `.env`.
 *
 * `.env.example` is the committed list of variables; this is the working copy,
 * and it is gitignored. Init writes it for one reason: `ADMIN_EMAIL` is the
 * only variable in the saas preset with no usable default. Left unset, the
 * first person to register gets `["user"]`, `/admin` answers 403, and the
 * preset's headline surface is unreachable until someone reads `Realm.ts` and
 * edits it — which is exactly the kind of step a scaffolder exists to remove.
 *
 * Only `ADMIN_EMAIL` is written. `APP_SECRET` stays out: a value generated
 * here would be a development secret sitting in a file that looks like the
 * one you deploy, and `SecretProvider` already fails closed in production with
 * a message naming the fix. Everything else has a working default.
 */
export const envLocal = (options: EnvLocalOptions) =>
  `
# Local environment. Gitignored — see .env.example for the full list.

# The first account registered with this address is promoted to admin.
# Taken from \`git config user.email\` when this project was created.
ADMIN_EMAIL=${options.adminEmail}
`.trim() + "\n";
