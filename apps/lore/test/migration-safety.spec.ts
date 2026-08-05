import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";
import { blights } from "../src/api/entities/blights.ts";
import { projects } from "../src/api/entities/projects.ts";
import { sigilErrorGroups } from "../src/api/entities/sigilErrorGroups.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { sigilUniquesDaily } from "../src/api/entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../src/api/entities/sigilVitalsHourly.ts";
import { users } from "../src/api/entities/users.ts";

const MIGRATIONS = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The tables the 2026-05 production wipe destroyed, plus the parent that
 * cascaded into them. Nothing in `migrations/sqlite` may ever name one of
 * these in a `DROP TABLE` — on Cloudflare D1 that is a silent `DELETE` of
 * every child row, reported as a successful deploy.
 *
 * See `apps/lore/CLAUDE.md` → "Migration safety on D1".
 */
const PROTECTED_TABLES = [
  // Still "campaigns" here on purpose: this scans the physical SQL in
  // migrations/sqlite/, and every migration on disk creates and references
  // a table literally named "campaigns" — the entity-level rename to
  // "projects" (2026-08 great rename, Task 6) does not touch that
  // directory. Task 11 adds the actual `ALTER TABLE campaigns RENAME TO
  // projects` migration; that is also the moment this guard matters
  // most, since a rename migration generated without `--hints` degrades to
  // a DROP+CREATE. Add "projects" alongside this entry once that
  // migration lands — do not just swap the name, or older migrations lose
  // their guard.
  "campaigns",
  "projects",
  "quests",
  "folios",
  "members",
  "users",
  // Still "petitions" here on purpose: this scans the physical SQL in
  // migrations/sqlite/, and every migration on disk creates and references
  // a table literally named "petitions" — the entity-level rename to
  // "feedback" (2026-08 great rename, Task 4) does not touch that
  // directory. Task 11 adds the actual `ALTER TABLE petitions RENAME TO
  // feedback` migration; that is also the moment this guard matters
  // most, since a rename migration generated without `--hints` degrades to
  // a DROP+CREATE. Add "feedback" alongside this entry once that
  // migration lands — do not just swap the name, or older migrations lose
  // their guard.
  "petitions",
  "feedback",
  // Still "chapters" here on purpose: this scans the physical SQL in
  // migrations/sqlite/, and every migration on disk creates and references
  // a table literally named "chapters" — the entity-level rename to
  // "milestones" (2026-08 great rename, Task 3) does not touch that
  // directory. Task 11 adds the actual `ALTER TABLE chapters RENAME TO
  // milestones` migration; that is also the moment this guard matters
  // most, since a rename migration generated without `--hints` degrades to
  // a DROP+CREATE. Add "milestones" alongside this entry once that
  // migration lands — do not just swap the name, or older migrations lose
  // their guard.
  "chapters",
  "milestones",
  "invitations",
  // Still "archive_directories" / "archive_blobs" here on purpose: this
  // scans the physical SQL in migrations/sqlite/, and every migration on
  // disk creates and references tables literally named "archive_directories"
  // / "archive_blobs" — the entity-level rename to "folioDirectories" /
  // "folioBlobs" (2026-08 great rename, Task 5) does not touch that
  // directory. Task 11 adds the actual `ALTER TABLE archive_directories
  // RENAME TO folio_directories` / `ALTER TABLE archive_blobs RENAME TO
  // folio_blobs` migrations; that is also the moment this guard matters
  // most, since a rename migration generated without `--hints` degrades to
  // a DROP+CREATE. Add "folio_directories" / "folio_blobs" alongside these
  // entries once those migrations land — do not just swap the names, or
  // older migrations lose their guard.
  "archive_directories",
  "archive_blobs",
  "folio_directories",
  "folio_blobs",
];

/**
 * Every applied migration, oldest first. `.archive/` (superseded
 * migrations — unrelated to this app's Archive/Folios feature) and any
 * stray file are skipped: a migration is a directory holding a
 * `migration.sql`.
 */
const migrationDirs = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((entry) => existsSync(join(MIGRATIONS, entry, "migration.sql")))
    .sort();

const migrationSql = (dir: string): string =>
  readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");

/**
 * Drop whole-line `--` comments so the scan reads statements, not prose.
 *
 * A migration that drops tables has to explain itself, and that explanation
 * necessarily names the tables it is careful NOT to touch — which the naive
 * scan then reports as the very thing it was written to prevent.
 */
const statementsOnly = (sql: string): string =>
  sql.replace(/^[ \t]*--.*$/gm, "");

describe("migration safety", () => {
  it("never drops a table the projects cascade reaches", ({ expect }) => {
    const dirs = migrationDirs();

    // A guard that silently scans nothing is worse than no guard.
    expect(dirs.length).toBeGreaterThan(0);

    for (const dir of dirs) {
      const sql = statementsOnly(migrationSql(dir));
      for (const table of PROTECTED_TABLES) {
        expect(sql, `${dir} drops the protected table '${table}'`).not.toMatch(
          new RegExp(`DROP\\s+TABLE[^;]*\\b${table}\\b`, "i"),
        );
      }
    }
  });

  it("keeps every project row and its children when the sigil family is rebuilt", ({
    expect,
  }) => {
    // better-sqlite3 is a devDependency of this app but not an ESM import
    // here — it is a native addon, and `createRequire` is how the vitest ESM
    // graph reaches one.
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");

    const db = new Database(":memory:");

    // D1 ignores `PRAGMA foreign_keys=OFF`, so constraints are ALWAYS live
    // there — including during `DROP TABLE`, whose implicit `DELETE FROM`
    // is what cascaded 2434 rows away in May 2026. Enforcing them here is
    // what makes this test reproduce D1 rather than the friendlier local
    // SQLite the rest of the suite runs on.
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of migrationSql(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    const dirs = migrationDirs();
    const rebuild = dirs.find((dir) => dir.endsWith("_sigil_family_rebuild"));
    expect(rebuild).toBeDefined();

    // Everything up to, but not including, the rebuild.
    for (const dir of dirs.slice(0, dirs.indexOf(rebuild!))) {
      apply(dir);
    }

    // Seed the exact shape of the 2026-05 incident: a project with children
    // hanging off it, and a sigil with children hanging off that.
    //
    // Still "campaigns" / "campaign_id" here on purpose — same reason as
    // PROTECTED_TABLES above: this seeds and applies the real migration SQL
    // on disk, which still creates a table literally named "campaigns" (and
    // FK columns literally named "campaign_id") until Task 11.
    const userId = "00000000-0000-4000-8000-000000000001";
    db.exec(`INSERT INTO users (id) VALUES ('${userId}')`);
    db.exec(
      `INSERT INTO campaigns (id, title, created_by) VALUES (1, 'Lore', '${userId}')`,
    );
    db.exec(
      `INSERT INTO quests (short_id, title, description, zone, priority, difficulty, campaign_id, created_by) VALUES (1, 'q', 'd', 'z', 'normal', 1, 1, '${userId}')`,
    );
    db.exec(
      `INSERT INTO folios (short_id, campaign_id, title) VALUES (1, 1, 'f')`,
    );
    db.exec(
      `INSERT INTO members (user_id, campaign_id) VALUES ('${userId}', 1)`,
    );
    // Still "petitions" here on purpose — same reason as PROTECTED_TABLES
    // above: this seeds and applies the real migration SQL on disk, which
    // still creates a table literally named "petitions" until Task 11.
    db.exec(
      `INSERT INTO petitions (short_id, campaign_id, title, description, status) VALUES (1, 1, 'p', 'd', 'pending')`,
    );
    db.exec(
      `INSERT INTO sigils (id, ingest_key, campaign_id, label) VALUES ('s1', 'k', 1, 'l')`,
    );
    db.exec(
      `INSERT INTO sigil_views (sigil_id, date, country, path) VALUES ('s1', '2026-01-01', 'FR', '/')`,
    );

    apply(rebuild!);

    const count = (table: string): number =>
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

    // The whole point: the rebuild reaches its own family and stops there.
    // "campaigns" (not "projects") and "petitions" (not "feedback") for the
    // same reason as the INSERTs above — this is the physical table name.
    for (const table of [
      "campaigns",
      "quests",
      "folios",
      "members",
      "petitions",
      "users",
    ]) {
      expect(count(table), `${table} lost rows to the rebuild`).toBe(1);
    }

    const tables: string[] = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row: { name: string }) => row.name);

    for (const table of [
      "sigils",
      "blights",
      "sigil_views_hourly",
      "sigil_vitals_hourly",
      "sigil_uniques_daily",
      "sigil_error_groups",
    ]) {
      expect(tables, `${table} missing after the rebuild`).toContain(table);
    }

    for (const table of [
      // "campaign_sources", not "project_sources" — this is the physical
      // (pre-rebuild) table name the sigil_family_rebuild migration drops on
      // disk, unrelated to the entity-level Campaign → Project rename.
      "campaign_sources",
      "sigil_blight_rate",
      "sigil_blights",
      "sigil_unique_visitors",
      "sigil_views",
      "sigil_vitals",
    ]) {
      expect(tables, `${table} survived the rebuild`).not.toContain(table);
    }

    db.close();
  });

  it("boots a fresh database with the sigil family present", async ({
    expect,
  }) => {
    // `sigils` carries FKs to `projects` and `users`, and the model builder
    // resolves every `db.ref(...)` eagerly at boot — so each referenced table
    // needs a repository too or schema sync throws before any assertion runs.
    class Repos {
      projects = $repository(projects);
      users = $repository(users);
      sigils = $repository(sigils);
      blights = $repository(blights);
      views = $repository(sigilViewsHourly);
      vitals = $repository(sigilVitalsHourly);
      uniques = $repository(sigilUniquesDaily);
      errorGroups = $repository(sigilErrorGroups);
    }

    // `DATABASE_URL` is a Postgres URL under the repo-root vitest config and
    // unset under this app's own — pinned here so the spec means the same
    // thing from both.
    const alepha = Alepha.create({ env: { DATABASE_URL: ":memory:" } }).with(
      Repos,
    );
    const repos = alepha.inject(Repos);
    await alepha.start();

    // Queried one by one rather than in a loop: each repository's `findMany`
    // is generic over its own entity, and an array of them collapses to a
    // union of signatures TypeScript refuses to call.
    expect(await repos.sigils.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.blights.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.views.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.vitals.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.uniques.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.errorGroups.findMany({ limit: 1 })).toEqual([]);
  });
});
