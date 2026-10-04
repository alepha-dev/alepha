/**
 * Serve this app's workerd build under local `wrangler dev`, over HTTPS, on
 * every interface, so a phone on the same network can reach it.
 *
 * Run `yarn build:workerd` first; that build binds a local D1 named `mobile`.
 * This script then:
 *
 * 1. stages `migrations/sqlite/<tag>/migration.sql` as flat `dist/migrations/<tag>.sql`,
 *    the only layout `wrangler d1 migrations apply` reads (handed the drizzle
 *    v1 layout it applies nothing and exits 0);
 * 2. applies them to a local D1 kept in `node_modules/.wrangler-mobile`, which
 *    survives a rebuild of `dist/`;
 * 3. starts `wrangler dev --local-protocol https`.
 *
 * The certificate comes from `MOBILE_TLS_CERT` and `MOBILE_TLS_KEY` (an mkcert
 * pair naming this machine's LAN address, see README.md). Without them,
 * wrangler uses its own self-signed certificate, which no phone trusts.
 *
 * `wrangler d1 migrations apply` wraps each migration in a transaction, which
 * the framework avoids on real data. This is a throwaway local database.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { AlephaError } from "alepha";

const APP_ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = join(APP_ROOT, "migrations", "sqlite");
const DIST = join(APP_ROOT, "dist");
const DEST = join(DIST, "migrations");
const STATE = join(APP_ROOT, "node_modules", ".wrangler-mobile");

if (!existsSync(join(DIST, "wrangler.jsonc"))) {
  throw new AlephaError(
    "No workerd build in dist/. Run 'yarn build:workerd' first.",
  );
}

const migrations = readdirSync(SOURCE, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: `${entry.name}.sql`,
    path: join(SOURCE, entry.name, "migration.sql"),
  }))
  .filter((migration) => existsSync(migration.path))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

if (migrations.length === 0) {
  throw new AlephaError(
    `No migrations in ${SOURCE}. Run 'yarn db:generate' first.`,
  );
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const migration of migrations) {
  cpSync(migration.path, join(DEST, migration.name));
}

execFileSync(
  "wrangler",
  ["d1", "migrations", "apply", "mobile", "--local", "--persist-to", STATE],
  { cwd: DIST, stdio: "inherit", env: { ...process.env, CI: "1" } },
);

const port = process.env.MOBILE_WORKERD_PORT ?? "8443";
const cert = process.env.MOBILE_TLS_CERT;
const key = process.env.MOBILE_TLS_KEY;
// Local only: this secret signs the tokens of a database that never leaves
// this machine.
const secret =
  process.env.APP_SECRET ?? "mobile-local-only-secret-change-me-0123";

execFileSync(
  "wrangler",
  [
    "dev",
    "--local-protocol",
    "https",
    ...(cert && key
      ? ["--https-cert-path", cert, "--https-key-path", key]
      : []),
    "--ip",
    "0.0.0.0",
    "--port",
    port,
    "--persist-to",
    STATE,
    "--var",
    `APP_SECRET:${secret}`,
  ],
  { cwd: DIST, stdio: "inherit" },
);
