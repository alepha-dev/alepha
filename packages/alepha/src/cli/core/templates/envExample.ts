export interface EnvExampleOptions {
  /**
   * Document `DATABASE_URL`. Set for presets that mount `AlephaOrm`, where
   * the variable is not optional in any meaningful sense — the app has
   * entities and nowhere to put them.
   */
  database?: boolean;
}

/**
 * The committed template for `.env`.
 *
 * It exists because the generated `.gitignore` already carries a
 * `!.env.example` negation — it expected this file all along — and because
 * `APP_SECRET` is a hard stop: `SecretProvider` refuses to boot in production
 * without it, so the very first `node dist/index.js` after `alepha build`
 * failed with nothing on disk pointing at the fix.
 *
 * `APP_SECRET` is left empty on purpose. A scaffolded secret would be a public
 * one, committed to every project generated from this template — worse than
 * none, because it looks configured.
 *
 * `DATABASE_URL` is documented but left commented out. Uncommenting it is a
 * downgrade in the default case: unset, the sqlite driver writes to
 * `node_modules/.alepha/sqlite.db`, alongside every other generated dev
 * artifact, and inherits `node_modules/`'s gitignore entry. Any path written
 * here instead lands in the project root, where nothing ignores it — see
 * `gitignore`, which deliberately does not carry a `*.db` rule because there
 * is no database file to ignore until someone opts out of the default.
 *
 * That default is development-only, and the text says so, because production
 * now refuses it: the scratch file is deleted by `npm ci`, and `alepha dev`
 * has already pushed a schema into it with an empty migrations journal, so a
 * production boot on the same file replayed every migration and died on the
 * first `CREATE TABLE`.
 */
export const envExample = (options: EnvExampleOptions = {}) =>
  `
# Copy to .env and fill in. .env is gitignored; this file is not.

# Signs sessions and tokens. Required in production — the app refuses to start
# without it. Generate one with:  openssl rand -hex 32
APP_SECRET=
${
  options.database
    ? `
# Database connection. Unset, development uses sqlite at
# node_modules/.alepha/sqlite.db — no configuration, nothing to gitignore,
# and it is removed with the rest of node_modules.
#
# REQUIRED IN PRODUCTION. That scratch path is a development file: \`npm ci\`
# deletes it, and \`alepha dev\` has already pushed your schema into it, so a
# production boot would try to migrate tables that already exist. Production
# refuses to start without this set. Point it at a path outside the bundle
# (sqlite:///var/lib/myapp/db.sqlite) or at a postgres://… URL.
#
# In development DATABASE_SYNC defaults to true, so the schema is pushed from
# your entities on boot and there is nothing to migrate. Before deploying, run
# \`alepha db migrations create\` to freeze it.
# DATABASE_URL=postgres://user:password@localhost:5432/mydb

# The first account registered with this address is promoted to admin — that
# is how the first admin is created. Read by \`$realm\` in src/api/Realm.ts.
# Your \`.env\` already has one, taken from \`git config user.email\`.
# ADMIN_EMAIL=
`
    : ""
}
# Port the server listens on. Falls back to PORT when unset, so hosts that
# allocate a port themselves work without configuration.
# SERVER_PORT=3000

# Log verbosity: trace | debug | info | warn | error
# Also accepts per-module rules, e.g. LOG_LEVEL=alepha.core:warn,info
# LOG_LEVEL=info

# Log rendering: cli | pretty | json
# LOG_FORMAT=cli
`.trim() + "\n";
