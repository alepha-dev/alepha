import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that gives the `prompts` capability to every project that
 * already used Prompts (#E175, #Q4313): a project with a row in `prompts`,
 * an agent job, or a host of its own that is an Agent host. Off by default
 * for every other project, so without it a project's schedules would stop
 * on deploy.
 */
describe("prompts capability migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261125124753_prompts_capability/migration.sql",
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
    db.exec(
      "CREATE TABLE prompts (id integer PRIMARY KEY, project_id integer NOT NULL)",
    );
    db.exec(
      "CREATE TABLE host_jobs (id integer PRIMARY KEY, project_id integer NOT NULL, kind text NOT NULL)",
    );
    db.exec(
      "CREATE TABLE hosts (id integer PRIMARY KEY, project_id integer NOT NULL, agent_host integer DEFAULT false NOT NULL)",
    );
    // 1 has a prompt, 2 an agent job, 3 an Agent host, 4 a check job and a
    // host that is no Agent host, 5 nothing, 6 a prompt and the row already.
    db.exec("INSERT INTO projects (id) VALUES (1), (2), (3), (4), (5), (6)");
    db.exec("INSERT INTO prompts (project_id) VALUES (1), (6)");
    db.exec(
      "INSERT INTO host_jobs (project_id, kind) VALUES (2, 'agent'), (4, 'check')",
    );
    db.exec("INSERT INTO hosts (project_id, agent_host) VALUES (3, 1), (4, 0)");
    db.exec(
      "INSERT INTO project_capabilities (project_id, key) VALUES (5, 'plan'), (6, 'prompts')",
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

  it("turns it on for the projects that used Prompts, and only them", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(keys(db)).toEqual([
      "1:prompts",
      "2:prompts",
      "3:prompts",
      "5:plan",
      "6:prompts",
    ]);
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    db.exec(sql);

    expect(keys(db)).toHaveLength(5);
  });
});
