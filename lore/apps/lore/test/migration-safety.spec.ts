import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { LoreCoreApi } from "@lore/core/api";
import { LoreDeployApi } from "@lore/deploy/api";
import { LoreKnowledgeApi } from "@lore/knowledge/api";
import { LoreWorkApi } from "@lore/work/api";
import { Alepha } from "alepha";
import { organizations } from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import {
  $repository,
  AlephaOrm,
  PG_REF,
  type PgRefOptions,
  RepositoryProvider,
} from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { blights } from "../src/api/entities/blights.ts";
import { projects } from "../src/api/entities/projects.ts";
import { sigilErrorGroups } from "../src/api/entities/sigilErrorGroups.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { sigilUniquesDaily } from "../src/api/entities/sigilUniquesDaily.ts";
import { users } from "../src/api/entities/users.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";

const MIGRATIONS = join(import.meta.dirname, "../migrations/sqlite");

/**
 * Every table this app's container serves a repository for, plus every table
 * one of those entities points a foreign key at: read from the booted
 * container rather than listed by hand, or by directory.
 *
 * ⚠️ The container, not `src/api/entities`: the entities are moving into the
 * `@lore/*` packages (#E75), and a directory walk would quietly cover fewer
 * tables with each move while staying green.
 *
 * Unless `PRAGMA foreign_keys=OFF` holds for it, drizzle-kit's rebuild
 * pattern (`CREATE __new`, `INSERT FROM SELECT`, `DROP old`, `RENAME`) fires
 * every constraint on the `DROP` — which for a CASCADE child is a silent
 * `DELETE` of every row, reported as a successful deploy. D1's query endpoint
 * ignores the pragma, and its import flow is not proven to honour it at scale
 * (#F1359). That cost all of lore-production once, in May 2026.
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
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreCoreApi);
  alepha.with(LoreWorkApi);
  alepha.with(LoreKnowledgeApi);
  alepha.with(LoreDeployApi);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const tables = new Set<string>();
  for (const repository of alepha
    .inject(RepositoryProvider)
    .getRepositories()) {
    const entity = repository.entity;
    tables.add(entity.name);
    for (const field of Object.values(entity.schema.shape)) {
      if (!field || typeof field !== "object" || !(PG_REF in field)) continue;
      const config = (field as Record<symbol, PgRefOptions>)[PG_REF];
      // A ref can reach a table no repository of this container serves.
      tables.add(config.ref().entity.name);
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
 * Tables this app dropped on purpose, which the entity walk no longer
 * produces because their entities went with them (#E74, #Q2604).
 *
 * The migrations before the drop still create and fill them, so they stay
 * guarded there, exactly like the renamed-away names above.
 */
const DROPPED_AWAY = [
  "members",
  "invitations",
  "rank_definitions",
  "sigil_views_hourly",
  "sigil_vitals_hourly",
  "analytics_backfills",
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
  // ⚠️ `deployments` is the SAME situation, one epic later. The 2026-08-05
  // Bay control plane shipped an `artifacts` table with a `deployments` beside
  // it, and this migration dropped both in the outpost purge the next day.
  // Epic #1 gave that name back on 2026-09-07 to a table with a different
  // shape - keyed on `app_instances`, carrying an `(app, tag, sha256)`
  // snapshot and a Cloudflare `version_id` - so the entity walk started
  // producing "deployments" and this historical drop became a violation
  // retroactively, exactly as "artifacts" did.
  //
  // Safe for the same reason: the old table has been gone from production
  // since 2026-08-06, the new one is created fresh by
  // `20260907102140_bright_gorilla_man`, and no migration between the two
  // touches either.
  "20260805233951_striped_captain_flint": ["artifacts", "deployments"],
  // ⚠️ The first entry here that sanctions a rebuild of a table holding LIVE
  // production rows. The two above are historical drops of dead tables whose
  // names were later reused; this one drops the `artifacts` everyone is using.
  //
  //
  // ⚠️ Regenerated after merging main: the first cut of this migration was
  // generated from a base that predated `20260908235005_release_default_since`,
  // so its snapshot silently dropped `releases.default_since` and
  // `check:migrations` wanted to re-add the column. Two migrations generated
  // in parallel from one base are mutually blind, and the timestamp order does
  // not save you - regenerate rather than renaming the directory.
  //
  // Epic #E47 gave `artifacts` a `format` dimension. `format` and `reference`
  // are plain `ALTER TABLE ADD`s and rebuild nothing - the rebuild is forced
  // by relaxing `size` and `file_id` to nullable, because an image row records
  // a registry reference and has no bytes, and SQLite has no `ALTER COLUMN`.
  // Sentinels were considered and rejected: four surfaces read those columns
  // and a value meaning "ignore me" is worse than an absent one.
  //
  // Safe because `artifacts` has no CASCADE children. Checked, not assumed, on
  // 2026-09-09: `grep -rn "artifacts.cols" src/api/entities/` is empty, no
  // migration in this directory contains ``REFERENCES `artifacts` ``, and
  // `deployments.artifactId` is a soft uuid with no foreign key. The same
  // finding is written into the migration itself, on the line above its DROP.
  //
  // ⚠️ It expires. The day any entity takes a `db.ref` onto
  // `artifacts.cols.id`, this reasoning is void and the NEXT rebuild of this
  // table has to be re-derived rather than waved through by citing this entry.
  "20260909124143_romantic_ben_urich": ["artifacts"],
  // #E74 / #Q2604: six frozen leaf tables, none of which any foreign key
  // points at (the cascade refusal above checks that against the previous
  // snapshot). Each DROP carries its own `alepha-allow-drop-table` marker.
  "20261004222909_drop_frozen_leaf_tables": DROPPED_AWAY,
  // #E74 / #Q2605: drizzle's rebuild of `folio_blobs` to drop `directory_id`,
  // a column with a foreign key that SQLite cannot drop in place. A leaf: no
  // foreign key points at it, which the cascade refusal checks.
  "20261004225050_drop_dead_folio_columns": ["folio_blobs"],
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

/**
 * The newest migration on disk when the cascade refusal below landed (#Q2602).
 *
 * Only migrations AFTER it are held to that refusal. Older ones shipped long
 * ago, and one of them (`20260801154537_sigil_family_rebuild`) sanctions a
 * `sigils` drop that has CASCADE children: refusing it now would change
 * nothing in production and only turn the suite red.
 */
const CASCADE_BASELINE = "20260929135124_folio_version";

/**
 * The slice of a drizzle-kit snapshot.json this guard reads: its foreign keys.
 */
interface SnapshotDdl {
  ddl: Array<{
    entityType: string;
    table?: string;
    tableTo?: string;
    columns?: string[];
    onDelete?: string;
  }>;
}

const migrationSnapshot = (dir: string): SnapshotDdl =>
  JSON.parse(readFileSync(join(MIGRATIONS, dir, "snapshot.json"), "utf8"));

/**
 * Every table a migration drops, bare or inside drizzle-kit's rebuild pattern
 * (`CREATE TABLE __new_x`, copy, `DROP TABLE x`, `RENAME TO x`): the rebuild
 * carries a plain `DROP TABLE x` too, so one pattern finds both. Comments are
 * skipped, as in `unsanctionedDrops`.
 */
const droppedTables = (sql: string): string[] => [
  ...new Set(
    [
      ...statementsOnly(sql).matchAll(
        /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi,
      ),
    ].map((match) => match[1]),
  ),
];

/**
 * The children a `DROP TABLE` of `table` would empty or detach, read from the
 * snapshot the migration runs AGAINST (the previous migration's), never from
 * the current entities: a migration that deletes an entity, or removes a ref in
 * the same change, would otherwise vanish from the walk.
 *
 * CASCADE deletes the child rows and SET NULL detaches them, both silently.
 * RESTRICT and NO ACTION make the drop fail, and D1 rolls a failed import
 * back, so neither is listed. A self-reference is not a child: its rows leave
 * with the table.
 */
const destructiveChildren = (table: string, previous: SnapshotDdl): string[] =>
  previous.ddl
    .filter(
      (entry) =>
        entry.entityType === "fks" &&
        entry.tableTo === table &&
        entry.table !== table &&
        (entry.onDelete === "CASCADE" || entry.onDelete === "SET NULL"),
    )
    .map((fk) => `${fk.table}.${(fk.columns ?? []).join(",")} (${fk.onDelete})`)
    .sort();

/**
 * What a migration newer than `CASCADE_BASELINE` may not drop.
 *
 * - A table with CASCADE or SET NULL children, **whatever `SANCTIONED_DROPS`
 *   says**: no entry can excuse it. Remove a column with `DROP COLUMN`
 *   instead, which drizzle-kit generates on its own for a column with no FK.
 * - Any other table without a `SANCTIONED_DROPS` entry for this migration,
 *   whether or not an entity still declares it.
 *
 * The framework's `alepha-allow-drop-table` marker is checked separately, by
 * `check:migrations`; a sanctioned leaf needs both.
 */
const dropViolations = (
  dir: string,
  sql: string,
  previous: SnapshotDdl,
  sanctionedDrops: Record<string, string[]> = SANCTIONED_DROPS,
): string[] => {
  if (dir <= CASCADE_BASELINE) return [];
  const sanctioned = sanctionedDrops[dir] ?? [];
  return droppedTables(sql).flatMap((table) => {
    const children = destructiveChildren(table, previous);
    if (children.length > 0) {
      return [
        `${table} has children it would wipe or detach: ${children.join(", ")}. ` +
          `No SANCTIONED_DROPS entry can excuse that: see "Migration safety on D1" in apps/lore/CLAUDE.md.`,
      ];
    }
    return sanctioned.includes(table)
      ? []
      : [`${table} is dropped without a SANCTIONED_DROPS entry`];
  });
};

describe("migration safety", () => {
  it("never drops a table this app owns, unsanctioned", async ({ expect }) => {
    const guarded = [
      ...(await entityTables()),
      ...RENAMED_AWAY,
      ...DROPPED_AWAY,
    ];
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
    const guarded = [
      ...(await entityTables()),
      ...RENAMED_AWAY,
      ...DROPPED_AWAY,
    ];

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

  it("never drops a table with children after the baseline, sanctioned or not", ({
    expect,
  }) => {
    const dirs = migrationDirs();
    expect(dirs).toContain(CASCADE_BASELINE);

    for (const dir of dirs.slice(dirs.indexOf(CASCADE_BASELINE) + 1)) {
      const previous = migrationSnapshot(dirs[dirs.indexOf(dir) - 1]);
      expect(
        dropViolations(dir, migrationSql(dir), previous),
        `${dir} drops a table it may not`,
      ).toEqual([]);
    }
  });

  describe("the cascade refusal", () => {
    const fk = (table: string, tableTo: string, onDelete: string) => ({
      entityType: "fks",
      table,
      tableTo,
      columns: [`${tableTo}_id`],
      onDelete,
    });
    const after = "20990101000000_synthetic";

    it("refuses the 2026-05 rebuild even when it is sanctioned", ({
      expect,
    }) => {
      // `0023_special_purifiers` predates the baseline migration and is not on
      // disk, so its shape is rebuilt here: `campaigns` with CASCADE children,
      // dropped by drizzle-kit's rebuild to move a column default.
      const previous = {
        ddl: [
          fk("characters", "campaigns", "CASCADE"),
          fk("quests", "campaigns", "CASCADE"),
          fk("folios", "campaigns", "CASCADE"),
        ],
      };
      const rebuild = `
        PRAGMA foreign_keys=OFF;--> statement-breakpoint
        CREATE TABLE \`__new_campaigns\` (\`id\` integer PRIMARY KEY);--> statement-breakpoint
        INSERT INTO \`__new_campaigns\` SELECT \`id\` FROM \`campaigns\`;--> statement-breakpoint
        -- alepha-allow-drop-table: the default moved
        DROP TABLE \`campaigns\`;--> statement-breakpoint
        ALTER TABLE \`__new_campaigns\` RENAME TO \`campaigns\`;--> statement-breakpoint
        PRAGMA foreign_keys=ON;
      `;

      const [violation] = dropViolations(after, rebuild, previous, {
        [after]: ["campaigns"],
      });
      expect(violation).toContain("campaigns has children");
      expect(violation).toContain("characters.campaigns_id (CASCADE)");
      expect(violation).toContain("Migration safety on D1");
    });

    it("refuses a parent whose only children are SET NULL", ({ expect }) => {
      const previous = {
        ddl: [
          fk("blights", "sigils", "SET NULL"),
          fk("app_instances", "sigils", "SET NULL"),
        ],
      };

      expect(
        dropViolations(after, "DROP TABLE `sigils`;", previous, {
          [after]: ["sigils"],
        }),
      ).toEqual([
        expect.stringContaining(
          "app_instances.sigils_id (SET NULL), blights.sigils_id (SET NULL)",
        ),
      ]);
    });

    it("ignores RESTRICT children and self-references", ({ expect }) => {
      const previous = {
        ddl: [
          fk("audits", "quests", "RESTRICT"),
          fk("quests", "quests", "SET NULL"),
        ],
      };

      expect(
        dropViolations(after, "DROP TABLE `quests`;", previous, {
          [after]: ["quests"],
        }),
      ).toEqual([]);
    });

    it("accepts a sanctioned leaf rebuild, and only a sanctioned one", ({
      expect,
    }) => {
      // `folio_blobs` points at its parents and nothing points at it.
      const previous = {
        ddl: [
          fk("folio_blobs", "projects", "CASCADE"),
          fk("folio_blobs", "folios", "CASCADE"),
        ],
      };
      const rebuild = `
        CREATE TABLE \`__new_folio_blobs\` (\`id\` text PRIMARY KEY);--> statement-breakpoint
        INSERT INTO \`__new_folio_blobs\` SELECT \`id\` FROM \`folio_blobs\`;--> statement-breakpoint
        -- alepha-allow-drop-table: folio_blobs is a leaf
        DROP TABLE \`folio_blobs\`;--> statement-breakpoint
        ALTER TABLE \`__new_folio_blobs\` RENAME TO \`folio_blobs\`;
      `;

      expect(
        dropViolations(after, rebuild, previous, { [after]: ["folio_blobs"] }),
      ).toEqual([]);
      expect(dropViolations(after, rebuild, previous, {})).toEqual([
        "folio_blobs is dropped without a SANCTIONED_DROPS entry",
      ]);
    });

    it("still accepts the sigil family rebuild, which predates the baseline", ({
      expect,
    }) => {
      const dirs = migrationDirs();
      const rebuild = dirs.find((dir) =>
        dir.endsWith("_sigil_family_rebuild"),
      )!;
      const previous = migrationSnapshot(dirs[dirs.indexOf(rebuild) - 1]);

      // It does drop a parent: the refusal would bite if it applied.
      expect(destructiveChildren("sigils", previous)).not.toEqual([]);
      expect(dropViolations(rebuild, migrationSql(rebuild), previous)).toEqual(
        [],
      );
    });
  });

  it("keeps every project row and its children when the sigil family is rebuilt", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");

    // D1 cannot be relied on to honour `PRAGMA foreign_keys=OFF` (#F1359),
    // so constraints are taken as live
    // there — including during `DROP TABLE`, whose implicit `DELETE FROM`
    // is what cascaded 2434 rows away in May 2026. Enforcing them here is
    // what makes this test reproduce D1 rather than the friendlier local
    // SQLite the rest of the suite runs on.
    db.exec("PRAGMA foreign_keys = ON");

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
    const db: any = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");

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
    const db: any = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");

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
      organizations = $repository(organizations);
      projects = $repository(projects);
      users = $repository(users);
      sigils = $repository(sigils);
      blights = $repository(blights);
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
    expect(await repos.uniques.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.errorGroups.findMany({ limit: 1 })).toEqual([]);
  });
});
