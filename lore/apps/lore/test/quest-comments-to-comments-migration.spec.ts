import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that copies `quest_comments` into core's `comments`
 * (#Q4517, #E185).
 *
 * Every database the suite builds starts empty and already has the new
 * shape: this spec builds the tables as they were, seeds a thread, and
 * applies the SQL for real.
 */
describe("quest comments to comments migration", () => {
  const migration = (name: string) =>
    readFileSync(
      join(import.meta.dirname, `../migrations/sqlite/${name}/migration.sql`),
      "utf8",
    ).replaceAll("--> statement-breakpoint", "");

  const AUTHOR = "11111111-1111-4111-8111-111111111111";
  const FILE = "22222222-2222-4222-8222-222222222222";

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE projects (id integer PRIMARY KEY)");
    db.exec("CREATE TABLE users (id text PRIMARY KEY)");
    db.exec(
      "CREATE TABLE quests (id integer PRIMARY KEY, project_id integer NOT NULL)",
    );
    // As production holds it: the baseline's table plus `attachments`.
    db.exec(
      "CREATE TABLE quest_comments (id integer PRIMARY KEY AUTOINCREMENT, created_at integer NOT NULL, updated_at integer NOT NULL, quest_id integer NOT NULL, author_id text, body text NOT NULL, edited_at integer, source text, attachments text)",
    );
    // The new table, by its own migration.
    db.exec(migration("20261126215001_comments"));
    db.exec("INSERT INTO projects (id) VALUES (1), (2)");
    db.prepare("INSERT INTO users (id) VALUES (?)").run(AUTHOR);
    db.exec("INSERT INTO quests (id, project_id) VALUES (10, 1), (20, 2)");
    const row = db.prepare(
      "INSERT INTO quest_comments (id, created_at, updated_at, quest_id, author_id, body, edited_at, source, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // A person's comment, edited, with a file.
    row.run(
      3,
      1_700_000_000_000,
      1_700_000_500_000,
      10,
      AUTHOR,
      "Do X differently, see [[#Q12]].",
      1_700_000_400_000,
      null,
      JSON.stringify([FILE]),
    );
    // An agent's, in another project, by an account since deleted.
    row.run(
      7,
      1_700_000_100_000,
      1_700_000_100_000,
      20,
      null,
      "Done as asked.",
      null,
      JSON.stringify({ kind: "mcp", client: "claude-code" }),
      null,
    );
    // Later in the same thread as the first.
    row.run(
      9,
      1_700_000_200_000,
      1_700_000_200_000,
      10,
      AUTHOR,
      "Thanks.",
      null,
      null,
      null,
    );
    return db;
  };

  const copy = migration("20261126215003_quest_comments_to_comments");

  it("copies every comment with its project, under the quest subject, field for field", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(copy);

    const rows = db
      .prepare(
        "SELECT project_id, subject_type, subject_id, author_id, body, created_at, updated_at, edited_at, source, attachments FROM comments ORDER BY id",
      )
      .all()
      .map((row: any) => ({ ...row }));

    expect(rows).toEqual([
      {
        project_id: 1,
        subject_type: "quest",
        subject_id: 10,
        author_id: AUTHOR,
        body: "Do X differently, see [[#Q12]].",
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_500_000,
        edited_at: 1_700_000_400_000,
        source: null,
        attachments: JSON.stringify([FILE]),
      },
      {
        project_id: 2,
        subject_type: "quest",
        subject_id: 20,
        author_id: null,
        body: "Done as asked.",
        created_at: 1_700_000_100_000,
        updated_at: 1_700_000_100_000,
        edited_at: null,
        source: JSON.stringify({ kind: "mcp", client: "claude-code" }),
        attachments: null,
      },
      {
        project_id: 1,
        subject_type: "quest",
        subject_id: 10,
        author_id: AUTHOR,
        body: "Thanks.",
        created_at: 1_700_000_200_000,
        updated_at: 1_700_000_200_000,
        edited_at: null,
        source: null,
        attachments: null,
      },
    ]);
  });

  it("leaves the old table as it was: the drop is a later migration's", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(copy);

    expect(
      db
        .prepare("SELECT id FROM quest_comments ORDER BY id")
        .all()
        .map((row: any) => row.id),
    ).toEqual([3, 7, 9]);
    expect(copy).not.toMatch(/drop\s+table/i);
    expect(copy).not.toMatch(/delete\s+from/i);
  });

  it("copies nothing from an empty table, which is every fresh database", ({
    expect,
  }) => {
    const db = seeded();
    db.exec("DELETE FROM quest_comments");
    db.exec(copy);

    expect(db.prepare("SELECT count(*) AS n FROM comments").get().n).toBe(0);
  });
});
