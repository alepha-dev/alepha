import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that copies `feedback_comments` into core's `comments`
 * (#Q4518, #E185). Built as `quest-comments-to-comments-migration.spec.ts`
 * is: the old tables by hand, a seeded thread, the SQL applied for real.
 */
describe("feedback comments to comments migration", () => {
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
      "CREATE TABLE feedback (id integer PRIMARY KEY, project_id integer NOT NULL)",
    );
    // As the baseline made it: `attachments` NOT NULL, defaulting to `[]`.
    db.exec(
      "CREATE TABLE feedback_comments (id integer PRIMARY KEY AUTOINCREMENT, created_at integer NOT NULL, updated_at integer NOT NULL, feedback_id integer NOT NULL, author_id text, body text NOT NULL, attachments text DEFAULT '[]' NOT NULL, edited_at integer, source text)",
    );
    db.exec(migration("20261126215001_comments"));
    db.exec("INSERT INTO projects (id) VALUES (1), (2)");
    db.prepare("INSERT INTO users (id) VALUES (?)").run(AUTHOR);
    db.exec("INSERT INTO feedback (id, project_id) VALUES (10, 1), (20, 2)");
    const row = db.prepare(
      "INSERT INTO feedback_comments (id, created_at, updated_at, feedback_id, author_id, body, attachments, edited_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // The reporter's answer, with a screenshot, edited.
    row.run(
      4,
      1_700_000_000_000,
      1_700_000_500_000,
      10,
      AUTHOR,
      "Safari only.",
      JSON.stringify([FILE]),
      1_700_000_400_000,
      null,
    );
    // An agent's finding on another project's item, no file.
    row.run(
      5,
      1_700_000_100_000,
      1_700_000_100_000,
      20,
      null,
      "Reproduced.",
      "[]",
      null,
      JSON.stringify({ kind: "mcp", client: "claude-code" }),
    );
    return db;
  };

  const copy = migration("20261126215004_feedback_comments_to_comments");

  it("copies every comment with its project, under the feedback subject, an empty file list as none", ({
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
        subject_type: "feedback",
        subject_id: 10,
        author_id: AUTHOR,
        body: "Safari only.",
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_500_000,
        edited_at: 1_700_000_400_000,
        source: null,
        attachments: JSON.stringify([FILE]),
      },
      {
        project_id: 2,
        subject_type: "feedback",
        subject_id: 20,
        author_id: null,
        body: "Reproduced.",
        created_at: 1_700_000_100_000,
        updated_at: 1_700_000_100_000,
        edited_at: null,
        source: JSON.stringify({ kind: "mcp", client: "claude-code" }),
        attachments: null,
      },
    ]);
  });

  it("leaves the old table as it was, and a quest thread already copied alone", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(
      "INSERT INTO comments (created_at, updated_at, project_id, subject_type, subject_id, body) VALUES (1, 1, 1, 'quest', 10, 'A quest comment')",
    );
    db.exec(copy);

    expect(
      db
        .prepare("SELECT id FROM feedback_comments ORDER BY id")
        .all()
        .map((row: any) => row.id),
    ).toEqual([4, 5]);
    expect(
      db
        .prepare(
          "SELECT subject_type, count(*) AS n FROM comments GROUP BY subject_type ORDER BY subject_type",
        )
        .all()
        .map((row: any) => [row.subject_type, row.n]),
    ).toEqual([
      ["feedback", 2],
      ["quest", 1],
    ]);
    expect(copy).not.toMatch(/drop\s+table/i);
    expect(copy).not.toMatch(/delete\s+from/i);
  });
});
