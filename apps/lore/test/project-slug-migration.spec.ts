import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Resolved from this file, not from `process.cwd()`: the root `vitest.config.ts`
 * and `apps/lore/vitest.config.ts` run with different working directories, and
 * a cwd-relative path here is green under one runner and red under the other.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * Guards the two D1 failure modes the `projects.slug` migration could have
 * introduced.
 *
 * Neither is reachable by running the app: every database CI, `yarn v` and the
 * test suite construct is empty, and a `DROP TABLE` only cascades on D1. So a
 * static read of the SQL is the only check that can go red — the same reasoning
 * as `migration-safety.spec.ts`.
 */
describe("projects.slug migration", () => {
  // `.archive/` holds migrations retired by `db create --baseline` and carries
  // no `migration.sql` of its own, so directories are filtered on the file
  // actually being there rather than on the name.
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  /**
   * The same file with `--` line comments removed.
   *
   * The destructive-statement guards below must read what the database will
   * execute, not the prose around it: this migration's own comments explain
   * why it carries no `DROP TABLE`, and a raw text match on the phrase fails
   * on the explanation rather than on a real drop.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const slugMigration = migrations.find((name) =>
    sqlOf(name).includes("ADD `slug`"),
  );

  it("exists", ({ expect }) => {
    expect(slugMigration).toBeDefined();
  });

  it("never drops a table", ({ expect }) => {
    // `projects` cascades into members/quests/milestones/folios/feedback.
    // A rebuild here is the 2026-05-13 production wipe.
    expect(statementsOf(slugMigration!)).not.toMatch(/DROP TABLE/i);
  });

  it("adds the column nullable", ({ expect }) => {
    // `ADD COLUMN … NOT NULL` is rejected by SQLite on a populated table, so it
    // is green on every empty CI database and red only on production.
    expect(statementsOf(slugMigration!)).not.toMatch(
      /ADD\s+`?slug`?[^;]*NOT NULL/i,
    );
  });

  it("carries a backfill", ({ expect }) => {
    // Without it every existing project has a NULL slug and no reachable URL.
    expect(statementsOf(slugMigration!)).toMatch(/UPDATE projects\s+SET slug/i);
  });

  it("deduplicates before creating the unique index", ({ expect }) => {
    const sql = statementsOf(slugMigration!);
    const dedupeAt = sql.indexOf("SELECT MIN(id)");
    const indexAt = sql.search(/CREATE UNIQUE INDEX/i);
    expect(dedupeAt).toBeGreaterThan(-1);
    expect(indexAt).toBeGreaterThan(-1);
    // A collision reaching the index aborts the whole migration.
    expect(dedupeAt).toBeLessThan(indexAt);
  });

  /**
   * The one that matters.
   *
   * `migration-safety.spec.ts` applies migrations only up to specific
   * historical points, so nothing in the suite had ever *executed* this
   * backfill — it was verified by reading it. That is the exact trap the rest
   * of this file guards against elsewhere: a statement can be green in review
   * and wrong against rows.
   *
   * So: build the schema as it stands the moment before this migration runs,
   * seed the shapes that are hard (a collision, an accent, a CJK title, a
   * separator run, a soft-deleted row), then apply this migration for real and
   * assert the slugs that come out. A syntax error, a bad `GLOB` class, or a
   * dedupe that lets a duplicate reach the unique index all fail here.
   */
  it("produces unique, usable slugs when applied to real rows", ({
    expect,
  }) => {
    // better-sqlite3 is a native addon, so `createRequire` is how the vitest
    // ESM graph reaches it — same as `migration-safety.spec.ts`.
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");

    // D1 ignores `PRAGMA foreign_keys=OFF`, so constraints are always live
    // there. Enforcing them here makes this reproduce D1 rather than the
    // friendlier local SQLite the rest of the suite runs on.
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    const upToSlug = migrations.slice(0, migrations.indexOf(slugMigration!));
    for (const dir of upToSlug) {
      apply(dir);
    }

    const seed = db.prepare(
      "INSERT INTO projects (id, title, created_by, deleted_at) VALUES (?, ?, ?, ?)",
    );
    const owner = "00000000-0000-0000-0000-000000000001";
    seed.run(1, "Hello World", owner, null);
    // Same slug as #1 once lowercased — the dedupe pass has to break the tie.
    seed.run(2, "hello world", owner, null);
    seed.run(3, "Elf - Summer", owner, null);
    // Transliteration is out of reach in SQLite; must land on the fallback.
    seed.run(4, "Élan Vital", owner, null);
    seed.run(5, "日本語", owner, null);
    seed.run(6, "my_project_name", owner, null);
    // Soft-deleted: skipped by the first UPDATE, so it must end up on the
    // fallback rather than NULL — a NULL would be fine for the index but
    // would leave `deleteProjectById`'s "slug is freed" contract ambiguous.
    seed.run(7, "Hello World", owner, "2026-01-01T00:00:00.000Z");

    apply(slugMigration!);

    const slugOf = (id: number) =>
      db.prepare("SELECT slug FROM projects WHERE id = ?").get(id).slug;

    expect(slugOf(1)).toBe("hello-world");
    // Lowest id keeps the clean slug; the collision gets its id appended.
    expect(slugOf(2)).toBe("hello-world-2");
    expect(slugOf(3)).toBe("elf-summer");
    expect(slugOf(4)).toBe("project-4");
    expect(slugOf(5)).toBe("project-5");
    expect(slugOf(6)).toBe("my-project-name");
    expect(slugOf(7)).toBe("project-7");

    // Every live project is addressable, and the unique index accepted the lot.
    const nulls = db
      .prepare("SELECT COUNT(*) AS n FROM projects WHERE slug IS NULL")
      .get().n;
    expect(nulls).toBe(0);

    const distinct = db
      .prepare("SELECT COUNT(DISTINCT slug) AS n FROM projects")
      .get().n;
    expect(distinct).toBe(7);

    db.close();
  });
});
