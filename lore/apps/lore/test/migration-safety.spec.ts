import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LoreCoreApi } from "@lore/core/api";
import { projects, users } from "@lore/core/schemas";
import { LoreDeployApi } from "@lore/deploy/api";
import {
  projectErrors,
  sigilErrorGroups,
  sigils,
  sigilUniquesDaily,
} from "@lore/deploy/schemas";
import { LoreKnowledgeApi } from "@lore/knowledge/api";
import { LorePlanApi } from "@lore/plan/api";
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

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Both migration folders (#Q3507): Postgres honours `ON DELETE` as D1 does,
 * so a `DROP TABLE` there detaches or empties the same children. Each folder
 * carries its own baseline, generated on a different day.
 */
const FOLDERS = {
  sqlite: {
    path: join(import.meta.dirname, "../migrations/sqlite"),
    baseline: "20261112161955_baseline",
  },
  postgres: {
    path: join(import.meta.dirname, "../migrations/postgres"),
    baseline: "20261112201552_baseline",
  },
} as const;

type Folder = keyof typeof FOLDERS;

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
 * See `apps/lore/AGENTS.md` → "Migration safety on D1".
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
  alepha.with(LorePlanApi);
  alepha.with(LoreKnowledgeApi);
  alepha.with(LoreDeployApi);
  bootLore(alepha, ["api", "mcp"]);

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
 * The rebuilds that are deliberate, keyed by the migration that performs them.
 *
 * An entry is a claim that this exact migration drops this exact table on
 * purpose. It is not a blanket exemption: the table stays guarded in every
 * other migration, before and after. A migration newer than
 * `CASCADE_BASELINE` may still never drop a table with CASCADE or SET NULL
 * children, whatever its entry says.
 *
 * Empty since the 2026-11-12 baseline (#Q3497): every sanctioned drop lived in
 * a migration the baseline replaced, and git history keeps their reasons.
 */
const SANCTIONED_DROPS: Record<string, string[]> = {};

/**
 * Every applied migration, oldest first. `.archive/` (superseded
 * migrations — unrelated to this app's Archive/Folios feature) and any
 * stray file are skipped: a migration is a directory holding a
 * `migration.sql`.
 */
const migrationDirs = (folder: Folder = "sqlite"): string[] =>
  readdirSync(FOLDERS[folder].path)
    .filter((entry) =>
      existsSync(join(FOLDERS[folder].path, entry, "migration.sql")),
    )
    .sort();

const migrationSql = (dir: string, folder: Folder = "sqlite"): string =>
  readFileSync(join(FOLDERS[folder].path, dir, "migration.sql"), "utf8");

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
  sanctionedDrops: Record<string, string[]> = SANCTIONED_DROPS,
): string[] => {
  const sanctioned = sanctionedDrops[dir] ?? [];
  return guarded.filter(
    (table) =>
      !sanctioned.includes(table) &&
      new RegExp(`DROP\\s+TABLE[^;]*\\b${table}\\b`, "i").test(sql),
  );
};

/**
 * The migration every later one is held to the cascade refusal against: the
 * 2026-11-12 baseline (#Q3497), which creates the whole schema and drops
 * nothing. The refusal itself dates from #Q2602.
 */
const CASCADE_BASELINE = FOLDERS.sqlite.baseline;

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

const migrationSnapshot = (
  dir: string,
  folder: Folder = "sqlite",
): SnapshotDdl =>
  JSON.parse(
    readFileSync(join(FOLDERS[folder].path, dir, "snapshot.json"), "utf8"),
  );

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
  baseline: string = CASCADE_BASELINE,
): string[] => {
  if (dir <= baseline) return [];
  const sanctioned = sanctionedDrops[dir] ?? [];
  return droppedTables(sql).flatMap((table) => {
    const children = destructiveChildren(table, previous);
    if (children.length > 0) {
      return [
        `${table} has children it would wipe or detach: ${children.join(", ")}. ` +
          `No SANCTIONED_DROPS entry can excuse that: see "Migration safety on D1" in apps/lore/AGENTS.md.`,
      ];
    }
    return sanctioned.includes(table)
      ? []
      : [`${table} is dropped without a SANCTIONED_DROPS entry`];
  });
};

describe("migration safety", () => {
  it("never drops a table this app owns, unsanctioned, in either folder", async ({
    expect,
  }) => {
    const guarded = [...(await entityTables())];
    const dirs = migrationDirs();
    expect(migrationDirs("postgres").length).toBeGreaterThan(0);

    // A guard that silently scans nothing is worse than no guard. Both halves:
    // an empty migration directory, and an entity walk that imported nothing.
    expect(dirs.length).toBeGreaterThan(0);
    expect(guarded.length).toBeGreaterThan(20);

    for (const table of [
      // The tables the 2026-05 wipe reached that still exist. The list is derived now,
      // but these are the incident and must never fall out of it silently.
      "projects",
      "quests",
      "folios",
      "users",
      "feedback",
      // Arrived after the incident and were never added to the hand-written
      // list. Pinned because they are the reason it was replaced: every one of
      // them was unguarded until the walk started producing them.
      "epics",
      "areas",
      "sigils",
      "sigil_uniques_daily",
      "sigil_error_groups",
      "folio_revisions",
      "quest_comments",
      "feedback_comments",
    ]) {
      expect(guarded, `${table} is no longer guarded`).toContain(table);
    }

    for (const folder of ["sqlite", "postgres"] as const) {
      for (const dir of migrationDirs(folder)) {
        expect(
          unsanctionedDrops(
            dir,
            statementsOnly(migrationSql(dir, folder)),
            guarded,
          ),
          `${folder}/${dir} drops a table this app owns without a SANCTIONED_DROPS entry`,
        ).toEqual([]);
      }
    }
  });

  it("catches a synthetic migration that drops a guarded table", async ({
    expect,
  }) => {
    const guarded = [...(await entityTables())];

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
    const sanctioned = { "20990101000000_sanctioned": ["sigils"] };
    expect(
      unsanctionedDrops(
        "20990101000000_sanctioned",
        "DROP TABLE `sigils`;",
        guarded,
        sanctioned,
      ),
    ).toEqual([]);
    expect(
      unsanctionedDrops(
        "20990101000000_synthetic",
        "DROP TABLE `sigils`;",
        guarded,
        sanctioned,
      ),
    ).toEqual(["sigils"]);
  });

  it("never drops a table with children after the baseline, sanctioned or not, in either folder", ({
    expect,
  }) => {
    for (const folder of ["sqlite", "postgres"] as const) {
      const { baseline } = FOLDERS[folder];
      const dirs = migrationDirs(folder);
      expect(dirs).toContain(baseline);

      for (const dir of dirs.slice(dirs.indexOf(baseline) + 1)) {
        const previous = migrationSnapshot(dirs[dirs.indexOf(dir) - 1], folder);
        expect(
          dropViolations(
            dir,
            migrationSql(dir, folder),
            previous,
            SANCTIONED_DROPS,
            baseline,
          ),
          `${folder}/${dir} drops a table it may not`,
        ).toEqual([]);
      }
    }
  });

  it("reads the postgres folder's foreign keys, so its cascade refusal bites", ({
    expect,
  }) => {
    const { baseline } = FOLDERS.postgres;
    const previous = migrationSnapshot(baseline, "postgres");
    const [violation] = dropViolations(
      "20990101000000_synthetic",
      'DROP TABLE "projects" CASCADE;',
      previous,
      { "20990101000000_synthetic": ["projects"] },
      baseline,
    );
    expect(violation).toMatch(/^projects has children it would wipe or detach/);
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
          fk("project_errors", "sigils", "SET NULL"),
          fk("app_instances", "sigils", "SET NULL"),
        ],
      };

      expect(
        dropViolations(after, "DROP TABLE `sigils`;", previous, {
          [after]: ["sigils"],
        }),
      ).toEqual([
        expect.stringContaining(
          "app_instances.sigils_id (SET NULL), project_errors.sigils_id (SET NULL)",
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
      projectErrors = $repository(projectErrors);
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
    expect(await repos.projectErrors.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.uniques.findMany({ limit: 1 })).toEqual([]);
    expect(await repos.errorGroups.findMany({ limit: 1 })).toEqual([]);
  });
});
