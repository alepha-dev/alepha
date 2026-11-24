import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The data half of the migration that removes Lore Build (#Q4217): a project
 * whose Build row had Quality on keeps it, on its Reports row; every Build
 * row goes; and every stored rank loses `code:*`.
 *
 * Every database the suite builds starts from the entities, with no Build
 * row and no `code:*` permission: this spec seeds them and applies the
 * migration's data statements for real (its table changes need the tables).
 */
describe("remove Lore Build migration", () => {
  const data = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261124003838_remove_lore_build/migration.sql",
    ),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .filter((statement) =>
      /^\s*(UPDATE|DELETE)\b/m.test(
        statement.replace(/^\s*--.*$/gm, "").trim(),
      ),
    )
    .join(";\n");

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE project_capabilities (id integer PRIMARY KEY, project_id integer NOT NULL, key text NOT NULL, options text DEFAULT '{}' NOT NULL)",
    );
    db.exec(
      "CREATE TABLE organization_ranks (id text PRIMARY KEY, key text NOT NULL, permissions text DEFAULT '[]' NOT NULL)",
    );
    const capability = db.prepare(
      "INSERT INTO project_capabilities (project_id, key, options) VALUES (?, ?, ?)",
    );
    // 1 had Quality on, 2 had Build with Quality off, 3 never had Build.
    capability.run(1, "build", '{"repositories":true,"quality":true}');
    capability.run(1, "reports", "{}");
    capability.run(2, "build", '{"repositories":true,"quality":false}');
    capability.run(2, "reports", "{}");
    capability.run(3, "reports", "{}");
    const rank = db.prepare(
      "INSERT INTO organization_ranks (id, key, permissions) VALUES (?, ?, ?)",
    );
    rank.run("a", "viewer", JSON.stringify(["project:read", "code:read"]));
    rank.run(
      "b",
      "custom",
      JSON.stringify(["code:write", "quest:read", "code:admin"]),
    );
    rank.run("c", "member", JSON.stringify(["quest:read"]));
    return db;
  };

  const capabilities = (db: any) =>
    db
      .prepare(
        "SELECT project_id, key, options FROM project_capabilities ORDER BY project_id, key",
      )
      .all()
      .map((row: any) => [row.project_id, row.key, JSON.parse(row.options)]);

  const ranks = (db: any) =>
    db
      .prepare("SELECT id, permissions FROM organization_ranks ORDER BY id")
      .all()
      .map((row: any) => [row.id, JSON.parse(row.permissions)]);

  it("moves Quality to Reports, drops every Build row and every code permission", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(data);

    expect(capabilities(db)).toEqual([
      [1, "reports", { quality: true }],
      [2, "reports", {}],
      [3, "reports", {}],
    ]);
    expect(ranks(db)).toEqual([
      ["a", ["project:read"]],
      ["b", ["quest:read"]],
      ["c", ["quest:read"]],
    ]);
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(data);
    const once = [capabilities(db), ranks(db)];
    db.exec(data);

    expect([capabilities(db), ranks(db)]).toEqual(once);
  });
});
