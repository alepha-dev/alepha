import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * Resolved from this file, not from `process.cwd()`, for the reason
 * `project-slug-migration.spec.ts` gives: the two vitest configs run with
 * different working directories.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The migration behind epic shelving (#E78, #Q2669, folio #1365).
 *
 * `shelved` itself needs no SQL: `epics.status` is `mode: "text"`, with no
 * CHECK constraint. What does is the marker `unshelveEpic` reads,
 * `quests.shelved_with_epic`, and `quests` is the parent `quest_comments`
 * cascades from and `quests.depends_on` points back at: a rebuild of it on
 * D1 would wipe every discussion and every questline link. This seeds rows
 * on both sides and applies the SQL for real, since every database the
 * rest of the suite builds is empty.
 */
describe("quest shelved-with-epic migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  const target = migrations.find((name) =>
    sqlOf(name).includes("ALTER TABLE `quests` ADD `shelved_with_epic`"),
  );

  it("exists, and is the one additive statement", ({ expect }) => {
    expect(target).toBeDefined();
    expect(sqlOf(target!).trim()).toBe(
      "ALTER TABLE `quests` ADD `shelved_with_epic` integer;",
    );
  });

  it("keeps every quest, its epic, its comments and its questline, and stores a shelved epic", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    // D1 enforces foreign keys whatever the pragma says; so does this.
    db.exec("PRAGMA foreign_keys = ON");

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
    db.prepare(
      "INSERT INTO epics (id, project_id, number, title, status) VALUES (1, 1, 1, 'working', 'in_progress')",
    ).run();

    const quest = db.prepare(
      "INSERT INTO quests (id, short_id, title, description, area, priority, project_id, created_by, epic_id, depends_on, shelved_at) VALUES (?, ?, 'Q', '', 'general', 'medium', 1, ?, 1, ?, ?)",
    );
    quest.run(1, 1, owner, null, null);
    // Shelved one by one before the column existed: it must read unmarked.
    quest.run(2, 2, owner, 1, "2026-10-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO quest_comments (quest_id, author_id, body) VALUES (1, ?, 'kept')",
    ).run(owner);

    apply(target!);

    const rows = db
      .prepare(
        "SELECT id, epic_id AS epicId, depends_on AS dependsOn, shelved_with_epic AS marked FROM quests ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { id: 1, epicId: 1, dependsOn: null, marked: null },
      { id: 2, epicId: 1, dependsOn: 1, marked: null },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM quest_comments").get().n).toBe(
      1,
    );

    // No CHECK constraint on the status, which is why `shelved` is code-only.
    db.prepare("UPDATE epics SET status = 'shelved' WHERE id = 1").run();
    expect(
      db.prepare("SELECT status FROM epics WHERE id = 1").get().status,
    ).toBe("shelved");

    db.close();
  });
});
