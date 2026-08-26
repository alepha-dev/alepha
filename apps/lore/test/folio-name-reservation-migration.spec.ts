import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "../migrations/sqlite");

const migrationDirs = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((entry) => existsSync(join(MIGRATIONS, entry, "migration.sql")))
    .sort();

const migrationSql = (dir: string): string =>
  readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");

const statementsOnly = (sql: string): string =>
  sql.replace(/^[ \t]*--.*$/gm, "");

/**
 * The reservation backfill is hand-written and cannot be regenerated: it
 * carries no schema change at all, only data. Nothing else in the pipeline
 * executes it, so this spec applies it against a seeded database - the same
 * reasoning as `folio-blob-scope-migration.spec.ts`.
 *
 * What it has to get right: existing folios come out reserved under the
 * right scope key, a folio whose name a sibling directory already holds does
 * not fail the whole statement, and `root_scope` stops being NULL so the
 * UNIQUE index actually bites inside a directory.
 */
describe("folio name reservation backfill migration", () => {
  const MIGRATION = "20260826140500_folio_name_reservations";

  it("carries no schema change", ({ expect }) => {
    const sql = statementsOnly(migrationSql(MIGRATION));
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
  });

  it("reserves every existing folio and repairs the NULL scope", ({
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
    const index = dirs.indexOf(MIGRATION);
    expect(index, "the reservation backfill is missing").toBeGreaterThan(-1);
    for (const dir of dirs.slice(0, index)) apply(dir);

    const userId = "00000000-0000-4000-8000-000000000010";
    db.exec(`INSERT INTO users (id) VALUES ('${userId}')`);
    db.exec(
      `INSERT INTO projects (id, title, created_by) VALUES (7, 'Lore', '${userId}')`,
    );
    db.exec(
      `INSERT INTO folio_directories (id, short_id, project_id, name) VALUES ('d1', 1, 7, 'Specs')`,
    );
    // At the project root, alongside a directory of the same name.
    db.exec(
      `INSERT INTO folios (id, short_id, project_id, title) VALUES ('f1', 1, 7, '  Notes  ')`,
    );
    db.exec(
      `INSERT INTO folios (id, short_id, project_id, title) VALUES ('f2', 2, 7, 'Specs')`,
    );
    // Inside the directory.
    db.exec(
      `INSERT INTO folios (id, short_id, project_id, directory_id, title) VALUES ('f3', 3, 7, 'd1', 'Notes')`,
    );
    // The directory's own reservation, written the pre-migration way with a
    // NULL root_scope for a nested row (this one is at the root, so it has
    // the sentinel) - plus one nested NULL row to repair.
    db.exec(
      `INSERT INTO folio_names (id, parent_directory_id, root_scope, lower_name, kind, entity_id)
       VALUES ('n1', 'root:7', '7', 'specs', 'directory', 'd1')`,
    );
    db.exec(
      `INSERT INTO folio_names (id, parent_directory_id, root_scope, lower_name, kind, entity_id)
       VALUES ('n2', 'd1', NULL, 'legacy', 'directory', 'd2')`,
    );

    apply(MIGRATION);

    const rows: Array<{
      entity_id: string;
      parent_directory_id: string;
      root_scope: string;
      lower_name: string;
      kind: string;
      id: string;
    }> = db.prepare("SELECT * FROM folio_names ORDER BY entity_id").all();

    const byEntity = new Map(rows.map((r) => [r.entity_id, r]));

    // Root folio: sentinel parent, project id as the root scope, trimmed
    // and lower-cased name.
    expect(byEntity.get("f1")).toMatchObject({
      parent_directory_id: "root:7",
      root_scope: "7",
      lower_name: "notes",
      kind: "folio",
    });
    // Nested folio: the directory uuid, and "" rather than NULL.
    expect(byEntity.get("f3")).toMatchObject({
      parent_directory_id: "d1",
      root_scope: "",
      lower_name: "notes",
      kind: "folio",
    });
    // "Specs" is already held by the directory at the root, so the folio
    // that shares it is skipped instead of failing the statement.
    expect(byEntity.has("f2")).toBe(false);
    // The pre-existing nested NULL is repaired.
    expect(byEntity.get("d2")?.root_scope).toBe("");

    // Every generated id is a v4 UUID - the entity schema reads the column
    // back as one, so `hex(randomblob(16))` would not have done.
    for (const row of rows) {
      if (row.id === "n1" || row.id === "n2") continue;
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }

    // The whole point: the UNIQUE index now rejects a duplicate INSIDE a
    // directory, which it silently accepted while root_scope was NULL.
    expect(() =>
      db.exec(
        `INSERT INTO folio_names (id, parent_directory_id, root_scope, lower_name, kind, entity_id)
         VALUES ('n3', 'd1', '', 'notes', 'folio', 'f9')`,
      ),
    ).toThrow(/UNIQUE/i);

    // Re-running is a no-op: the backfill skips folios already reserved.
    apply(MIGRATION);
    const after: Array<{ n: number }> = db
      .prepare("SELECT COUNT(*) AS n FROM folio_names")
      .all();
    expect(after[0].n).toBe(rows.length);
  });
});
