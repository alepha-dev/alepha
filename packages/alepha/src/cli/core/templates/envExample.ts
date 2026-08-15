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
 * none, because it looks configured. `DATABASE_URL` carries a real default
 * instead: a local sqlite file is not a secret, and the alternative is an app
 * that cannot boot until you have read the ORM docs.
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
# Database connection. sqlite is enough to develop against; swap in
# postgres://… for production.
#
# In development DATABASE_SYNC defaults to true, so the schema is pushed from
# your entities on boot and there is nothing to migrate. Before deploying, run
# \`alepha db migrations create\` to freeze it.
DATABASE_URL=sqlite://./data.db
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
`.trim();
