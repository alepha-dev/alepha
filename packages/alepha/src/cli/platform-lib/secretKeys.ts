/**
 * The env keys no adapter pushes as a runtime secret.
 *
 * Two groups, both of which the platform decides rather than the app:
 *
 * - **Binding/build vars.** The deploy target supplies these itself —
 *   `DATABASE_URL` from a D1 binding or Bay's managed SQLite, `SERVER_PORT`
 *   from whatever allocated it. Pushing the local value would point a
 *   deployed app at a development machine.
 * - **Framework infra knobs.** `LOG_LEVEL`, `DEBUG` and friends all have
 *   defaults, and a build manifest's `env` auto-list surfaces every declared
 *   `$env` key — so they have to be excluded here to keep a CI runner's own
 *   environment out of the push.
 *
 * Lives on its own rather than on {@link CloudflareAdapter} because a second
 * adapter needs the same answer. Two hand-maintained copies of a list like this
 * drift silently: the copy that is missing a key does not fail, it pushes one
 * more secret than it should, and nothing says so until a deployed app is
 * reading a laptop's `DATABASE_URL`.
 */
export const EXCLUDED_SECRET_KEYS: ReadonlySet<string> = new Set([
  "DATABASE_URL",
  "R2_BUCKET_NAME",
  "CLOUDFLARE_DOMAIN",
  "CLOUDFLARE_ZONE",
  "CLOUDFLARE_JURISDICTION",
  "HYPERDRIVE_ID",
  "POSTGRES_SCHEMA",
  "NODE_ENV",
  // Framework infra knobs (have defaults, never worker secrets). The
  // manifest's `env` auto-list surfaces every declared `$env` key, so
  // exclude these here to keep them out of the secret push even when a CI
  // runner happens to set them (LOG_LEVEL, DEBUG, etc.).
  "LOG_LEVEL",
  "LOG_FORMAT",
  "SERVER_HOST",
  "SERVER_PORT",
  "TRUST_PROXY",
  "REACT_SSR_ENABLED",
  "DATABASE_SYNC",
  "DEBUG",
]);
