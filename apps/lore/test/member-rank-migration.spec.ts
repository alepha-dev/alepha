import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Resolved from this file, not from `process.cwd()`: the root
 * `vitest.config.ts` and `apps/lore/vitest.config.ts` run with different
 * working directories, and a cwd-relative path is green under one runner and
 * red under the other.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The `members.rank` backfill, executed rather than read.
 *
 * This is the highest-severity statement in epic #E39. `assertMember` let a
 * project's creator through with NO membership row at all, and
 * `createProject` was not transactional until #Q1926 - so a failed third write
 * leaves exactly that state, and `projects.created_by` has been the invisible
 * net repairing it on every request. The epic removes the net.
 *
 * A project missed by half 2 below is a project whose owner is locked out
 * permanently, with no path back short of a manual database write. Nothing
 * else in the pipeline executes this SQL: every test database is built from
 * the entities and is already in the new shape, so reading the statement is
 * the only other option and reading is what this file exists not to rely on.
 */
describe("members.rank migration", () => {
  // `.archive/` holds migrations retired by `db create --baseline` and carries
  // no `migration.sql`, so directories are filtered on the file being there
  // rather than on the name.
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
   * The guards below must read what the database will execute, not the prose
   * around it: this migration's own comments explain why it carries no
   * `DROP TABLE` and no partial unique index, and a raw text match fails on
   * the explanation rather than on a real one.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const rankMigration = migrations.find((name) =>
    sqlOf(name).includes("ADD `rank`"),
  );

  it("exists", ({ expect }) => {
    expect(rankMigration).toBeDefined();
  });

  it("never drops a table and never rebuilds one", ({ expect }) => {
    // `members` has no children, but `projects` is the CASCADE parent that
    // wiped production in 2026-05, and a rebuild reached from here would take
    // it with them.
    const sql = statementsOf(rankMigration!);
    expect(sql).not.toMatch(/DROP TABLE/i);

    // ⚠️ A bare `CREATE TABLE` is allowed, and the assertion narrowed rather
    // than the file split. This migration also creates `rank_definitions`,
    // because the two were regenerated into one file when origin/main moved
    // under the branch - two migrations written in parallel from one base
    // leave the LAST snapshot claiming neither change exists.
    //
    // What must never appear is drizzle's REBUILD, which is `CREATE TABLE
    // __new_x`, `INSERT FROM SELECT`, `DROP`, `RENAME` - and the `DROP` is
    // what cascades on D1. A new table is not that.
    expect(sql).not.toMatch(/CREATE TABLE\s+`?__new/i);
    expect(sql).not.toMatch(/CREATE TABLE\s+`?members`?\s*\(/i);
    expect(sql).not.toMatch(/INSERT INTO\s+`?__new/i);
  });

  it("adds the column nullable", ({ expect }) => {
    // `ADD COLUMN … NOT NULL` is refused by SQLite on a populated table, so it
    // is green on every empty CI database and red only against the one
    // database that has rows.
    expect(statementsOf(rankMigration!)).not.toMatch(
      /ADD\s+`?rank`?[^;]*NOT NULL/i,
    );
  });

  it("creates no partial unique index on the owner rank", ({ expect }) => {
    // Rejected by decision, not by omission: D1 has no transactions and SQLite
    // checks UNIQUE per row while a statement runs, so a one-statement
    // ownership transfer could trip it mid-statement depending on row order.
    //
    // ⚠️ On `members` specifically. The file carries a unique index on
    // `rank_definitions`, which is a different table and a different question:
    // one definition per `(type, scope, key)` is not "one owner per project".
    expect(statementsOf(rankMigration!)).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*ON\s+`?members`?/i,
    );
  });

  it("touches no column of projects", ({ expect }) => {
    expect(statementsOf(rankMigration!)).not.toMatch(/UPDATE\s+projects/i);
    expect(statementsOf(rankMigration!)).not.toMatch(
      /ALTER TABLE\s+`?projects/i,
    );
  });

  /**
   * The one that matters: applied to rows, including the shapes that are hard.
   */
  it("leaves every live project with exactly one owner", ({ expect }) => {
    // better-sqlite3 is a native addon, so `createRequire` is how the vitest
    // ESM graph reaches it - same as `migration-safety.spec.ts`.
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");

    // D1 ignores `PRAGMA foreign_keys=OFF`, so constraints are always live
    // there. Enforcing them here reproduces D1 rather than the friendlier
    // local SQLite the rest of the suite runs on.
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    for (const dir of migrations.slice(0, migrations.indexOf(rankMigration!))) {
      apply(dir);
    }

    const creator = "00000000-0000-0000-0000-000000000001";
    const invitee = "00000000-0000-0000-0000-000000000002";
    const orphanCreator = "00000000-0000-0000-0000-000000000003";

    const user = db.prepare("INSERT INTO users (id, email) VALUES (?, ?)");
    user.run(creator, "creator@example.com");
    user.run(invitee, "invitee@example.com");
    user.run(orphanCreator, "orphan@example.com");

    const project = db.prepare(
      "INSERT INTO projects (id, title, slug, created_by, deleted_at) VALUES (?, ?, ?, ?, ?)",
    );
    // 1: the ordinary shape - creator has a row, an invitee has another.
    project.run(1, "Ordinary", "ordinary", creator, null);
    // 2: the dangerous shape - the creator has NO membership row, which is
    // what a failed third write in `createProject` leaves behind. Half 2 has
    // to repair it or this project's owner is locked out for good.
    project.run(2, "Orphaned", "orphaned", orphanCreator, null);
    // 3: soft-deleted. Skipped: every read path filters it out, so a row here
    // would repair nothing and would occupy the unique index if it came back.
    project.run(3, "Deleted", null, creator, 1757000000000);

    const member = db.prepare(
      "INSERT INTO members (id, user_id, project_id, owner) VALUES (?, ?, ?, ?)",
    );
    member.run(1, creator, 1, 1);
    // ⚠️ `owner = true` on somebody who did not create the project. The column
    // defaults to `true` and has two writers, so production carries rows like
    // this: the UI shows them owner buttons the server refuses. After the
    // backfill they are `member`, consistent with the server for the first
    // time.
    member.run(2, invitee, 1, 1);
    member.run(3, creator, 3, 1);

    apply(rankMigration!);

    const rankOf = (userId: string, projectId: number) =>
      db
        .prepare(
          "SELECT rank FROM members WHERE user_id = ? AND project_id = ?",
        )
        .get(userId, projectId)?.rank;

    // Half 1: the creator becomes owner; nobody else is written at all.
    expect(rankOf(creator, 1)).toBe("owner");
    expect(rankOf(invitee, 1)).toBe(null);

    // Half 2: the orphaned creator now has a row, and it says owner.
    expect(rankOf(orphanCreator, 2)).toBe("owner");

    // The soft-deleted project's existing row is still backfilled (it is a
    // member row like any other), but no NEW row was invented for it.
    expect(rankOf(creator, 3)).toBe("owner");

    // The whole claim, as one query: every live project has exactly one owner.
    const offenders = db
      .prepare(
        `SELECT p.id, COUNT(m.id) AS owners
           FROM projects p
           LEFT JOIN members m
             ON m.project_id = p.id AND m.rank = 'owner'
          WHERE p.deleted_at IS NULL
          GROUP BY p.id
         HAVING owners <> 1`,
      )
      .all();
    expect(offenders).toEqual([]);

    db.close();
  });
});
