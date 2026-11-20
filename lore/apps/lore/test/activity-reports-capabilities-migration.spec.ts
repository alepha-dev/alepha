import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that gives every existing project the `activity` and
 * `reports` capabilities (#Q4007): both were Core pages until then, and a
 * capability without a row is off, so without it every project would lose
 * its Activity page and Reports on deploy.
 */
describe("activity and reports capabilities migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261121020256_activity_reports_capabilities/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE projects (id integer PRIMARY KEY)");
    db.exec(
      "CREATE TABLE project_capabilities (id integer PRIMARY KEY, project_id integer NOT NULL, key text NOT NULL, options text DEFAULT '{}' NOT NULL)",
    );
    db.exec(
      "CREATE UNIQUE INDEX project_capabilities_project_id_key_idx ON project_capabilities (project_id, key)",
    );
    db.exec("INSERT INTO projects (id) VALUES (1), (2)");
    db.exec(
      "INSERT INTO project_capabilities (project_id, key) VALUES (1, 'plan'), (2, 'reports')",
    );
    return db;
  };

  const keys = (db: any) =>
    db
      .prepare(
        "SELECT project_id, key FROM project_capabilities ORDER BY project_id, key",
      )
      .all()
      .map((row: any) => `${row.project_id}:${row.key}`);

  it("turns both on for every project, keeping what was there", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(keys(db)).toEqual([
      "1:activity",
      "1:plan",
      "1:reports",
      "2:activity",
      "2:reports",
    ]);
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    db.exec(sql);

    expect(keys(db)).toHaveLength(5);
  });
});
