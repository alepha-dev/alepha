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
 * The folio-scoping migration is hand-written, which means nothing
 * regenerates it: a future `db:generate` that rewrites this file silently
 * restores drizzle-kit's table rebuild — and a rebuild of `folio_blobs` is a
 * cascade wipe on D1 (see the migration's own comment block, and
 * `migration-safety.spec.ts`'s PROTECTED_TABLES).
 *
 * `migration-safety.spec.ts` scans every migration for `DROP TABLE`, so the
 * rebuild would already go red there. What it cannot check is whether this
 * SQL actually *runs* — the reason it is hand-written is that three separate
 * SQLite rules constrain it (index before column drop, no `NOT NULL` on an
 * added referencing column, foreign keys live during the whole thing). So
 * this applies it for real.
 */
describe("folio blob scoping migration", () => {
  const MIGRATION = "20260814123446_giant_madelyne_pryor";

  it("is ALTER-only — never rebuilds the table", ({ expect }) => {
    const sql = statementsOnly(migrationSql(MIGRATION));
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/__new_folio_blobs/i);
  });

  it("applies against a real database with foreign keys enforced", ({
    expect,
  }) => {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");

    // D1 ignores `PRAGMA foreign_keys=OFF`, so constraints are ALWAYS live
    // there. Enforcing them here is what makes this reproduce D1 rather than
    // the friendlier local SQLite the rest of the suite runs on.
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of migrationSql(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    const dirs = migrationDirs();
    const index = dirs.indexOf(MIGRATION);
    expect(
      index,
      "the folio blob scoping migration is missing",
    ).toBeGreaterThan(-1);

    for (const dir of dirs.slice(0, index)) apply(dir);

    // Seed the cascade shape the migration must not disturb: a project with a
    // folio in it, and a directory holding a blob that this migration retires.
    const userId = "00000000-0000-4000-8000-000000000010";
    db.exec(`INSERT INTO users (id) VALUES ('${userId}')`);
    db.exec(
      `INSERT INTO projects (id, title, created_by) VALUES (1, 'Lore', '${userId}')`,
    );
    db.exec(
      `INSERT INTO folios (id, short_id, project_id, title) VALUES ('f1', 1, 1, 'Notes')`,
    );
    db.exec(
      `INSERT INTO folio_directories (id, short_id, project_id, name) VALUES ('d1', 1, 1, 'Assets')`,
    );
    db.exec(
      `INSERT INTO files (id, blob_id, bucket, name, size, mime_type) VALUES ('x1', 'b1', 'archive-blobs', 'photo.webp', 10, 'image/webp')`,
    );
    db.exec(
      `INSERT INTO folio_blobs (file_id, short_id, project_id, directory_id, name) VALUES ('x1', 1, 1, 'd1', 'photo.webp')`,
    );

    apply(MIGRATION);

    const columns: Array<{ name: string }> = db
      .prepare("PRAGMA table_info(folio_blobs)")
      .all();
    const names = columns.map((column) => column.name);
    expect(names).toContain("folio_id");
    // `directory_id` deliberately survives — SQLite cannot drop a column
    // carrying a foreign key, and the rebuild that could is the D1 wipe.
    expect(names).toContain("directory_id");

    // The folio and its project are untouched — the whole point of not
    // rebuilding. The retired blob row is gone, by design.
    expect(db.prepare("SELECT COUNT(*) AS n FROM folios").get().n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM projects").get().n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM folio_blobs").get().n).toBe(0);

    // And the new FK actually bites: deleting a folio takes its attachments.
    db.exec(
      `INSERT INTO files (id, blob_id, bucket, name, size, mime_type) VALUES ('x2', 'b2', 'archive-blobs', 'a.webp', 10, 'image/webp')`,
    );
    db.exec(
      `INSERT INTO folio_blobs (file_id, short_id, project_id, folio_id, name) VALUES ('x2', 2, 1, 'f1', 'a.webp')`,
    );
    db.exec("DELETE FROM folios WHERE id = 'f1'");
    expect(db.prepare("SELECT COUNT(*) AS n FROM folio_blobs").get().n).toBe(0);

    db.close();
  });
});
