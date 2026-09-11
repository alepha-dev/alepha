import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Resolved from this file, not from `process.cwd()`, for the reason
 * `project-slug-migration.spec.ts` gives: the two vitest configs run with
 * different working directories.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The migration that renamed an epic's first status from `planned` to
 * `draft` (#Q2269).
 *
 * `epics.status` is an enum validated on READ, so a row left saying
 * `planned` fails to decode and takes every epic query with it: the
 * 2026-08-05 incident's shape. Every database the suite builds is empty, so
 * no other spec can see that. This one seeds the old value and applies the
 * SQL for real.
 */
describe("epic draft-status migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  /**
   * What the database executes, without the `--` prose around it, so the
   * guard below reads statements and not the comment explaining why the
   * generated rebuild was removed.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const target = migrations.find((name) =>
    statementsOf(name).includes(
      "UPDATE `epics` SET `status` = 'draft' WHERE `status` = 'planned'",
    ),
  );

  it("exists", ({ expect }) => {
    expect(target).toBeDefined();
  });

  it("never drops a table", ({ expect }) => {
    // drizzle generated a rebuild of `epics` to move the column DEFAULT. On
    // D1 its DROP TABLE fires `quests.epic_id`, `folios.epic_id` and
    // `epics.depends_on` (all SET NULL) and detaches every quest and folio
    // from its epic, silently.
    expect(statementsOf(target!)).not.toMatch(/DROP TABLE/i);
  });

  it("rewrites planned epics to draft and leaves the other statuses alone", ({
    expect,
  }) => {
    // better-sqlite3 is a native addon, so `createRequire` is how the vitest
    // ESM graph reaches it, as in `migration-safety.spec.ts`.
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    // D1 enforces foreign keys whatever the pragma says; so does this.
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    for (const dir of migrations.slice(0, migrations.indexOf(target!))) {
      apply(dir);
    }

    const owner = "00000000-0000-0000-0000-000000000001";
    db.prepare("INSERT INTO users (id) VALUES (?)").run(owner);
    db.prepare(
      "INSERT INTO projects (id, title, created_by) VALUES (1, 'P', ?)",
    ).run(owner);

    const epic = db.prepare(
      "INSERT INTO epics (id, project_id, number, title, status) VALUES (?, 1, ?, ?, ?)",
    );
    epic.run(1, 1, "specifying", "planned");
    epic.run(2, 2, "specified", "ready");
    epic.run(3, 3, "working", "in_progress");
    epic.run(4, 4, "shipped", "completed");

    // A quest filed in the planned epic, so the test also proves the rewrite
    // leaves it attached: detaching it is what a rebuild would have done.
    db.prepare(
      "INSERT INTO quests (short_id, title, description, area, priority, project_id, created_by, epic_id) VALUES (1, 'Q', '', 'general', 'medium', 1, ?, 1)",
    ).run(owner);

    apply(target!);

    const statusOf = (id: number) =>
      db.prepare("SELECT status FROM epics WHERE id = ?").get(id).status;

    expect(statusOf(1)).toBe("draft");
    expect(statusOf(2)).toBe("ready");
    expect(statusOf(3)).toBe("in_progress");
    expect(statusOf(4)).toBe("completed");
    expect(
      db.prepare("SELECT epic_id AS epicId FROM quests WHERE short_id = 1").get()
        .epicId,
    ).toBe(1);

    // The property the whole migration exists for: nothing left that the
    // entity would refuse to decode.
    const retired = db
      .prepare(
        "SELECT COUNT(*) AS n FROM epics WHERE status NOT IN ('draft', 'ready', 'in_progress', 'completed')",
      )
      .get().n;
    expect(retired).toBe(0);

    db.close();
  });
});
