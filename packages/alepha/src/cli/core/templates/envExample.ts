/**
 * The committed template for `.env`.
 *
 * It exists because the generated `.gitignore` already carries a
 * `!.env.example` negation — it expected this file all along — and because
 * `APP_SECRET` is a hard stop: `SecretProvider` refuses to boot in production
 * without it, so the very first `node dist/index.js` after `alepha build`
 * failed with nothing on disk pointing at the fix.
 *
 * Values are left empty on purpose. A scaffolded secret would be a public one,
 * committed to every project generated from this template — worse than none,
 * because it looks configured.
 */
export const envExample = () =>
  `
# Copy to .env and fill in. .env is gitignored; this file is not.

# Signs sessions and tokens. Required in production — the app refuses to start
# without it. Generate one with:  openssl rand -hex 32
APP_SECRET=

# Port the server listens on.
# SERVER_PORT=3000

# Log verbosity: trace | debug | info | warn | error
# Also accepts per-module rules, e.g. LOG_LEVEL=alepha.core:warn,info
# LOG_LEVEL=info

# Log rendering: cli | pretty | json
# LOG_FORMAT=cli
`.trim();
