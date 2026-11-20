import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that turns Build's two new options on for every project that
 * already had Build (#Q4005): an absent option reads off, so without it those
 * projects would lose git hosting and their Quality tab on deploy.
 *
 * Every database the suite builds starts from the entities, with no Build row
 * written before the split: this spec seeds such rows and applies the SQL
 * for real.
 */
describe("build options migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261121020224_build_options/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE project_capabilities (id integer PRIMARY KEY, project_id integer NOT NULL, key text NOT NULL, options text DEFAULT '{}' NOT NULL)",
    );
    const capability = db.prepare(
      "INSERT INTO project_capabilities (project_id, key, options) VALUES (?, ?, ?)",
    );
    capability.run(1, "build", "{}");
    capability.run(2, "ship", '{"track":true}');
    capability.run(3, "build", '{"quality":false}');
    return db;
  };

  const rows = (db: any) =>
    db
      .prepare(
        "SELECT project_id, key, options FROM project_capabilities ORDER BY project_id",
      )
      .all()
      .map((row: any) => [row.project_id, row.key, JSON.parse(row.options)]);

  it("turns both options on for every Build row, as JSON booleans, and nothing else", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(rows(db)).toEqual([
      [1, "build", { repositories: true, quality: true }],
      [2, "ship", { track: true }],
      [3, "build", { repositories: true, quality: true }],
    ]);
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    const once = rows(db);
    db.exec(sql);

    expect(rows(db)).toEqual(once);
  });
});
