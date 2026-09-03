/**
 * Stage this app's migrations into `dist/` and apply them to the local
 * miniflare D1 that the e2e suite runs against.
 *
 * Why this exists rather than a one-line `cp` + `wrangler d1 migrations apply`:
 *
 * 1. **Layout.** drizzle-kit v1 emits `<timestamp>_<name>/migration.sql`
 *    directories; v0 emitted flat `<name>.sql`. `wrangler d1 migrations apply`
 *    only understands the flat form — handed the v1 layout it finds nothing,
 *    applies nothing, and exits 0. The app then boots against an empty
 *    database and every request fails with `no such table`. That is exactly
 *    how this broke: CI went red with `D1_ERROR: no such table: views` while
 *    the migration step reported success. So we flatten `<tag>/migration.sql`
 *    to `<tag>.sql` on the way into `dist/`, which is the shape wrangler's own
 *    bookkeeping expects.
 *
 * 2. **Determinism.** The e2e run persists miniflare state to a fixed path
 *    outside the repo. A stale state directory kept the tables alive across
 *    runs, so this bug passed locally and only surfaced on a clean CI
 *    checkout. Wiping the state first means the suite always exercises a
 *    real migration against an empty database — the case that actually
 *    matters.
 *
 * This app is a throwaway test fixture, so `wrangler d1 migrations apply` is
 * fine here despite the framework avoiding it elsewhere (it wraps migrations
 * in a transaction, which defeats `PRAGMA foreign_keys=OFF` and cascade-wipes
 * child rows on a table rebuild). There is no data here to lose.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = join(APP_ROOT, "migrations", "sqlite");
const DEST = join(APP_ROOT, "dist", "migrations");
// Inside the checkout, not /tmp: the e2e port allocation lets two worktrees
// run this suite at once, and a shared state directory had the second run
// wipe the first one's database mid-suite.
const STATE = join(APP_ROOT, "node_modules", ".wrangler-e2e");
const DB_NAME = "emerald";

/**
 * Collect migrations from both layouts, keyed by the name wrangler will
 * record. Unreadable entries are reported rather than skipped — an empty
 * result that looks like success is the failure mode this script exists to
 * prevent.
 */
const collect = (dir: string): Array<{ name: string; path: string }> => {
  const found: Array<{ name: string; path: string }> = [];
  const unrecognized: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "meta" || entry.name.startsWith(".")) continue;

    if (entry.isFile() && entry.name.endsWith(".sql")) {
      found.push({ name: entry.name, path: join(dir, entry.name) });
      continue;
    }

    if (entry.isDirectory()) {
      const sql = join(dir, entry.name, "migration.sql");
      if (existsSync(sql)) {
        found.push({ name: `${entry.name}.sql`, path: sql });
        continue;
      }
    }

    unrecognized.push(entry.name);
  }

  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized entries in ${dir}: ${unrecognized.join(", ")}. ` +
        "Expected flat '<name>.sql' files or '<tag>/migration.sql' directories.",
    );
  }

  if (found.length === 0) {
    throw new Error(
      `No migrations found in ${dir}. Refusing to start the e2e suite against ` +
        "an empty database — run 'yarn alepha db migrations create' first.",
    );
  }

  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};

rmSync(STATE, { recursive: true, force: true });
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

const migrations = collect(SOURCE);
for (const migration of migrations) {
  cpSync(migration.path, join(DEST, migration.name));
}
console.log(
  `Staged ${migrations.length} migration(s): ${migrations.map((m) => m.name).join(", ")}`,
);

execFileSync(
  "wrangler",
  [
    "d1",
    "migrations",
    "apply",
    DB_NAME,
    "--cwd",
    "dist",
    "--local",
    "--persist-to",
    STATE,
  ],
  { cwd: APP_ROOT, stdio: "inherit", env: { ...process.env, CI: "1" } },
);
