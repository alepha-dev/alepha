import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { Alepha } from "alepha";
import { $repository, PG_REF, type PgRefOptions } from "alepha/orm";
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
const ENTITIES = join(import.meta.dirname, "../src/api/entities");

/**
 * Every table this app declares an entity for, plus every table one of those
 * entities points a foreign key at — read from the registry rather than
 * listed by hand.
 *
 * On Cloudflare D1 `PRAGMA foreign_keys=OFF` is ignored, so drizzle-kit's
 * rebuild pattern (`CREATE __new`, `INSERT FROM SELECT`, `DROP old`,
 * `RENAME`) fires every constraint on the `DROP` — which for a CASCADE child
 * is a silent `DELETE` of every row, reported as a successful deploy. That
 * cost all of lore-production once, in May 2026.
 *
 * ⚠️ Derived, because the hand-written list rotted exactly as a hand-written
 * list does. It named the tables the 2026-05 wipe reached and nothing added
 * since: `epics`, `areas`, `sigils` and its four aggregates, `folio_revisions`
 * and the two comment tables all arrived after it and were never added.
 *
 * **Every table, not only the cascade parents.** The parents are where the
 * silent wipe lives, and the FK walk is what finds them without anyone
 * maintaining a list. But `members` and `invitations` are cascade *children*
 * that nothing points at, so a parents-only list would have quietly dropped
 * two tables the 2026-05 incident actually destroyed — and a `DROP TABLE`
 * naming any of this app's tables deserves a human reading the migration
 * either way. The sanctioned ones are enumerated below.
 *
 * See `apps/lore/CLAUDE.md` → "Migration safety on D1".
 */
const entityTables = async (): Promise<string[]> => {
  const tables = new Set<string>();

  for (const file of readdirSync(ENTITIES).filter((f) => f.endsWith(".ts"))) {
    const mod: Record<string, unknown> = await import(join(ENTITIES, file));
    for (const value of Object.values(mod)) {
      const entity = value as { name?: unknown; schema?: { shape?: object } };
      if (typeof entity.name !== "string" || !entity.schema?.shape) continue;
      tables.add(entity.name);
      for (const field of Object.values(entity.schema.shape)) {
        if (!field || typeof field !== "object" || !(PG_REF in field)) continue;
        const config = (field as Record<symbol, PgRefOptions>)[PG_REF];
        // A ref can reach a framework table (`users`, `files`) that this app
        // declares no entity file for.
        tables.add(config.ref().entity.name);
      }
    }
  }

  return [...tables].sort();
};

/**
 * Physical table names the entity registry can no longer produce, because the
 * entity was renamed and the migrations on disk were not.
 *
 * `migrations/sqlite/` still creates and references tables literally named
 * `campaigns`, `petitions`, `chapters`, `archive_directories` and
 * `archive_blobs`: the 2026-08 great rename is an `ALTER TABLE … RENAME TO`
 * late in the chain, so every migration before it speaks the old name. Drop
 * these and the whole pre-rename history loses its guard.
 */
const RENAMED_AWAY = [
  "campaigns",
  "petitions",
  "chapters",
  "archive_directories",
  "archive_blobs",
];

/**
 * The rebuilds that are deliberate, keyed by the migration that performs them.
 *
 * An entry is a claim that this exact migration drops this exact table on
 * purpose. It is not a blanket exemption: the table stays guarded in every
 * other migration, before and after.
 *
 * That per-migration shape is what the old list could not express, and it is
 * why `sigils` had to sit outside it in a hand-written second test. `sigils`
 * is the CASCADE parent of the four aggregate tables (`sigil_views_hourly`,
 * `sigil_uniques_daily`, `sigil_vitals_hourly`, `sigil_error_groups`), so a
 * `DROP TABLE sigils` on D1 silently deletes every row in all four — but
 * `20260801154537_sigil_family_rebuild` legitimately drops it and recreates it
 * two statements later. Excluding the table wholesale left it unguarded in
 * every later migration, which is precisely where it matters:
 * `20260806093400_confused_dazzler` folded three columns into `name` with
 * additive `ALTER TABLE`s and no rebuild, because a rebuild there would have
 * been a wipe.
 */
const SANCTIONED_DROPS: Record<string, string[]> = {
  // The whole sigil family, recreated in the same migration. `blights`
  // rides along because it hung off the old `sigils`.
  "20260801154537_sigil_family_rebuild": ["sigils", "blights"],
  // `folio_links` gained a polymorphic source side. Reviewed and rehearsed
  // against a production export (611 rows in, 611 out) before merging: it is
  // a LEAF — nothing in the schema references it — so the rebuild pattern
  // carries no cascade here. The migration's own header carries the check
  // that proves it: `grep -rn "folioLinks.cols" src/api/entities/` must be
  // empty.
  "20260819225121_cloudy_lila_cheney": ["folio_links"],
  // ⚠️ NOT a rebuild, and not a table that existed when this guard was
  // written. `artifacts` was the server half of the abandoned Bay control
  // plane, shipped 2026-08-05 and dropped here with the rest of the outpost
  // purge the day after. Epic #18 gave the NAME back to a new table with a
  // different shape - `(projectId, app, tag, runtime)`, sha256-addressed, no
  // `deployments` beside it - so the entity walk started producing "artifacts"
  // and this historical drop became a violation retroactively.
  //
  // Sanctioned rather than renamed around: the old table has been gone from
  // production for a month, `artifacts` is the honest name for what the new
  // one holds, and the per-migration shape of this list is exactly what lets
  // one dead drop be excused without unguarding the live table anywhere else.
  "20260805233951_striped_captain_flint": ["artifacts"],
};

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

/**
 * The guarded tables this migration drops without being sanctioned for it.
 *
 * Extracted so the guard below and the self-test that proves it bites are the
 * same code — a scanner nothing ever runs against a real violation is a
 * scanner that reports success for the wrong reason.
 */
const unsanctionedDrops = (
  dir: string,
  sql: string,
  guarded: string[],
): string[] => {
  const sanctioned = SANCTIONED_DROPS[dir] ?? [];
  return guarded.filter(
    (table) =>
      !sanctioned.includes(table) &&
      new RegExp(`DROP\\s+TABLE[^;]*\\b${table}\\b`, "i").test(sql),
  );
};

describe("migration safety", () => {
  it("never drops a table this app owns, unsanctioned", async ({ expect }) => {
    const guarded = [...(await entityTables()), ...RENAMED_AWAY];
    const dirs = migrationDirs();

    // A guard that silently scans nothing is worse than no guard. Both halves:
    // an empty migration directory, and an entity walk that imported nothing.
    expect(dirs.length).toBeGreaterThan(0);
    expect(guarded.length).toBeGreaterThan(20);

    for (const table of [
      // The six the 2026-05 wipe actually reached. The list is derived now,
      // but these are the incident and must never fall out of it silently.
      "projects",
      "quests",
      "folios",
      "members",
      "users",
      "feedback",
      // Arrived after the incident and were never added to the hand-written
      // list. Pinned because they are the reason it was replaced: every one of
      // them was unguarded until the walk started producing them.
      "epics",
      "areas",
      "sigils",
      "sigil_views_hourly",
      "sigil_uniques_daily",
      "sigil_vitals_hourly",
      "sigil_error_groups",
      "folio_revisions",
      "quest_comments",
      "feedback_comments",
    ]) {
      expect(guarded, `${table} is no longer guarded`).toContain(table);
    }

    for (const dir of dirs) {
      expect(
        unsanctionedDrops(dir, statementsOnly(migrationSql(dir)), guarded),
        `${dir} drops a table this app owns without a SANCTIONED_DROPS entry`,
      ).toEqual([]);
    }
  });

  it("catches a synthetic migration that drops a guarded table", async ({
    expect,
  }) => {
    const guarded = [...(await entityTables()), ...RENAMED_AWAY];

    // Exactly what drizzle-kit emits for a rebuild, and the shape that wiped
    // production: the DROP is the third statement, wrapped in the innocuous
    // create/copy/rename around it.
    const rebuild = `
      CREATE TABLE \`__new_projects\` (\`id\` integer PRIMARY KEY);
      INSERT INTO \`__new_projects\` SELECT \`id\` FROM \`projects\`;
      DROP TABLE \`projects\`;
      ALTER TABLE \`__new_projects\` RENAME TO \`projects\`;
    `;
    expect(
      unsanctionedDrops("20990101000000_synthetic", rebuild, guarded),
    ).toEqual(["projects"]);

    // A sanctioned drop is sanctioned only in its own migration.
    expect(
      unsanctionedDrops(
        "20260801154537_sigil_family_rebuild",
        "DROP TABLE `sigils`;",
        guarded,
      ),
    ).toEqual([]);
    expect(
      unsanctionedDrops(
        "20990101000000_synthetic",
        "DROP TABLE `sigils`;",
        guarded,
      ),
    ).toEqual(["sigils"]);
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
      // Still \`zone\`, not \`area\` — same reason as \`campaigns\` above. This
      // seeds against the physical schema as it stood before the rebuild, and
      // the Zone -> Area rename comes several migrations later.
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

  /**
   * The vitals histogram moved from a `bucket_counts` JSON column to seven
   * integer columns. drizzle-kit generated the seven `ADD COLUMN`s and the
   * `DROP COLUMN` and **nothing in between** — applied as generated it would
   * have thrown away every histogram in production.
   *
   * The backfill was added by hand, which means nothing regenerates it: a
   * future `db:generate` that rewrites this migration drops it silently. This
   * runs the real SQL against a real SQLite database with a real row to make
   * that a red test rather than a quiet data loss.
   */
  it("carries the vitals histogram across the JSON-to-columns migration", ({
    expect,
  }) => {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of migrationSql(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    const dirs = migrationDirs();
    const bucketColumns = dirs.find((dir) =>
      dir.endsWith("_vitals_bucket_columns"),
    );
    expect(
      bucketColumns,
      "the vitals bucket-columns migration is missing",
    ).toBeDefined();

    for (const dir of dirs.slice(0, dirs.indexOf(bucketColumns!))) {
      apply(dir);
    }

    const userId = "00000000-0000-4000-8000-000000000002";
    db.exec(`INSERT INTO users (id) VALUES ('${userId}')`);
    db.exec(
      `INSERT INTO projects (id, title, created_by) VALUES (1, 'Lore', '${userId}')`,
    );
    db.exec(
      `INSERT INTO sigils (id, project_id, name, token_hash, token_prefix) VALUES ('s1', 1, 'app', 'h', 'pfx')`,
    );
    // Two shapes that both have to survive: a populated histogram, and an
    // empty one (a row can exist with no samples in any bucket yet).
    db.exec(
      `INSERT INTO sigil_vitals_hourly (sigil_id, hour, metric, path, bucket_counts)
       VALUES ('s1', '2026-01-01T10', 'lcp', '/', '{"0":2,"5":1}'),
              ('s1', '2026-01-01T11', 'cls', '/', '{}')`,
    );

    apply(bucketColumns!);

    const rows = db
      .prepare(
        "SELECT metric, b0, b1, b2, b3, b4, b5, b6 FROM sigil_vitals_hourly ORDER BY hour",
      )
      .all();

    expect(rows).toEqual([
      { metric: "lcp", b0: 2, b1: 0, b2: 0, b3: 0, b4: 0, b5: 1, b6: 0 },
      { metric: "cls", b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 },
    ]);

    db.close();
  });

  /**
   * The Zone → Area rename is a `RENAME COLUMN`, and it has to stay one.
   * Without a `--hints` rename hint drizzle-kit emits CREATE + DROP for the
   * same entity diff, which passes every schema check and silently discards
   * every quest's area — exactly the data the rename exists to keep.
   *
   * Seeds real values before the migration and reads them back after, rather
   * than pattern-matching the SQL: the failure mode is lost rows, so lost rows
   * is what this asserts.
   */
  it("carries quest areas and project areas across the Zone to Area rename", ({
    expect,
  }) => {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of migrationSql(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    const dirs = migrationDirs();
    const rename = dirs.find((dir) => dir.endsWith("_zone_to_area"));
    expect(rename, "the zone_to_area migration is missing").toBeDefined();

    for (const dir of dirs.slice(0, dirs.indexOf(rename!))) {
      apply(dir);
    }

    const userId = "00000000-0000-4000-8000-000000000003";
    db.exec(`INSERT INTO users (id) VALUES ('${userId}')`);
    db.exec(
      `INSERT INTO projects (id, title, created_by, zones) VALUES (1, 'Lore', '${userId}', '["Bugs","UX"]')`,
    );
    db.exec(
      `INSERT INTO quests (short_id, title, description, zone, priority, difficulty, project_id, created_by)
       VALUES (1, 'q', 'd', 'Bugs', 'medium', 1, 1, '${userId}')`,
    );

    apply(rename!);

    const quest = db.prepare("SELECT area FROM quests").get();
    const project = db.prepare("SELECT areas FROM projects").get();
    expect(quest.area).toBe("Bugs");
    expect(JSON.parse(project.areas)).toEqual(["Bugs", "UX"]);

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
