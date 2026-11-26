import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that copies `requirements_comments` into core's `comments`
 * (#Q4519, #E185): the old table by hand, a seeded thread, the SQL applied
 * for real. Its own subject: the two agent columns folding into `source`.
 */
describe("requirements comments to comments migration", () => {
  const migration = (name: string) =>
    readFileSync(
      join(import.meta.dirname, `../migrations/sqlite/${name}/migration.sql`),
      "utf8",
    ).replaceAll("--> statement-breakpoint", "");

  const AUTHOR = "11111111-1111-4111-8111-111111111111";

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE projects (id integer PRIMARY KEY)");
    db.exec("CREATE TABLE users (id text PRIMARY KEY)");
    db.exec(
      "CREATE TABLE requirements_comments (id integer PRIMARY KEY AUTOINCREMENT, created_at integer NOT NULL, updated_at integer NOT NULL, project_id integer NOT NULL, subject_kind text NOT NULL, subject_id integer NOT NULL, author_id text, body text NOT NULL, agent_client text, by_agent integer)",
    );
    db.exec(migration("20261126215001_comments"));
    db.exec("INSERT INTO projects (id) VALUES (1), (2)");
    db.prepare("INSERT INTO users (id) VALUES (?)").run(AUTHOR);
    const row = db.prepare(
      "INSERT INTO requirements_comments (id, created_at, updated_at, project_id, subject_kind, subject_id, author_id, body, agent_client, by_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // A person, on a persona.
    row.run(
      1,
      1_700_000_000_000,
      1_700_000_000_000,
      1,
      "persona",
      5,
      AUTHOR,
      "She also exports.",
      null,
      null,
    );
    // A named agent, on a use case.
    row.run(
      2,
      1_700_000_100_000,
      1_700_000_100_000,
      1,
      "usecase",
      5,
      AUTHOR,
      "Step 3 fails.",
      "claude-code",
      1,
    );
    // An agent that gave no name, in another project.
    row.run(
      3,
      1_700_000_200_000,
      1_700_000_200_000,
      2,
      "usecase",
      8,
      null,
      "Verified.",
      null,
      1,
    );
    // A name with nothing saying a machine wrote it: a person's.
    row.run(
      4,
      1_700_000_300_000,
      1_700_000_300_000,
      2,
      "persona",
      9,
      AUTHOR,
      "Odd row.",
      "stray",
      0,
    );
    return db;
  };

  const copy = migration("20261126215005_requirements_comments_to_comments");

  it("copies every comment under its subject kind, the agent columns as one source", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(copy);

    const rows = db
      .prepare(
        "SELECT project_id, subject_type, subject_id, author_id, body, created_at, source, attachments, edited_at FROM comments ORDER BY id",
      )
      .all()
      .map((row: any) => ({
        ...row,
        source: row.source === null ? null : JSON.parse(row.source),
      }));

    expect(rows).toEqual([
      {
        project_id: 1,
        subject_type: "persona",
        subject_id: 5,
        author_id: AUTHOR,
        body: "She also exports.",
        created_at: 1_700_000_000_000,
        source: null,
        attachments: null,
        edited_at: null,
      },
      {
        project_id: 1,
        subject_type: "usecase",
        subject_id: 5,
        author_id: AUTHOR,
        body: "Step 3 fails.",
        created_at: 1_700_000_100_000,
        source: { kind: "mcp", client: "claude-code" },
        attachments: null,
        edited_at: null,
      },
      {
        project_id: 2,
        subject_type: "usecase",
        subject_id: 8,
        author_id: null,
        body: "Verified.",
        created_at: 1_700_000_200_000,
        // No `client` key at all: a null there would not read back.
        source: { kind: "mcp" },
        attachments: null,
        edited_at: null,
      },
      {
        project_id: 2,
        subject_type: "persona",
        subject_id: 9,
        author_id: AUTHOR,
        body: "Odd row.",
        created_at: 1_700_000_300_000,
        source: null,
        attachments: null,
        edited_at: null,
      },
    ]);
  });

  it("leaves the old table as it was: the drop is a later migration's", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(copy);

    expect(
      db.prepare("SELECT count(*) AS n FROM requirements_comments").get().n,
    ).toBe(4);
    expect(copy).not.toMatch(/drop\s+table/i);
    expect(copy).not.toMatch(/delete\s+from/i);
  });
});
