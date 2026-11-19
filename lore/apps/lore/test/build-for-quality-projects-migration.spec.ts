import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that turns `build` on for every project holding a quality
 * run (#E162, #Q3944): Quality moved from Ship to Build, so without it those
 * projects would lose their Quality tab.
 *
 * Every database the suite builds starts from the entities, with no quality
 * run written before the move: this spec seeds such rows and applies the SQL
 * for real.
 */
describe("build for quality projects migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261119151925_build_for_quality_projects/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE project_capabilities (id integer PRIMARY KEY, project_id integer NOT NULL, key text NOT NULL, enabled_at integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL, options text DEFAULT '{}' NOT NULL)",
    );
    db.exec(
      "CREATE UNIQUE INDEX project_capabilities_project_id_key_idx ON project_capabilities (project_id, key)",
    );
    db.exec(
      "CREATE TABLE quality_runs (id text PRIMARY KEY, project_id integer NOT NULL)",
    );
    const capability = db.prepare(
      "INSERT INTO project_capabilities (project_id, key) VALUES (?, ?)",
    );
    capability.run(1, "ship");
    capability.run(2, "plan");
    capability.run(3, "build");
    capability.run(4, "ship");
    const run = db.prepare(
      "INSERT INTO quality_runs (id, project_id) VALUES (?, ?)",
    );
    // Project 1 pushed twice, 2 once, 3 already has Build, 4 never pushed.
    run.run("a", 1);
    run.run("b", 1);
    run.run("c", 2);
    run.run("d", 3);
    return db;
  };

  const builds = (db: any) =>
    db
      .prepare(
        "SELECT project_id, options FROM project_capabilities WHERE key = 'build' ORDER BY project_id",
      )
      .all()
      .map((row: any) => [row.project_id, JSON.parse(row.options)]);

  it("turns build on for every project with a run, once, and for no other", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(builds(db)).toEqual([
      [1, {}],
      [2, {}],
      [3, {}],
    ]);
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    db.exec(sql);

    expect(builds(db)).toHaveLength(3);
  });
});
