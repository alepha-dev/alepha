import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that renames the capability keys after Lore's three pillars
 * (#E143, #Q3501): `work`, `knowledge`, `apps` become `plan`, `remember`,
 * `ship`, in `project_capabilities.key` and in the `metadata.capability` of
 * the audit rows that turned one on or off.
 *
 * Every database the suite builds starts from the entities, so no other spec
 * sees an old key: this one seeds rows of each old key and applies the SQL
 * for real.
 */
describe("pillar capability keys migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261114101109_pillar_capability_keys/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE project_capabilities (id integer PRIMARY KEY, project_id integer, key text NOT NULL, options text DEFAULT '{}' NOT NULL)",
    );
    db.exec(
      "CREATE UNIQUE INDEX project_capabilities_project_id_key_idx ON project_capabilities (project_id, key)",
    );
    db.exec(
      "CREATE TABLE audits (id integer PRIMARY KEY, type text NOT NULL, action text NOT NULL, metadata text)",
    );
    const capability = db.prepare(
      "INSERT INTO project_capabilities (id, project_id, key, options) VALUES (?, ?, ?, ?)",
    );
    capability.run(1, 1, "work", JSON.stringify({ epics: true, board: false }));
    capability.run(2, 1, "knowledge", JSON.stringify({ agentSummary: true }));
    capability.run(3, 1, "apps", JSON.stringify({ track: true, deploy: true }));
    capability.run(4, 1, "support", "{}");
    capability.run(5, 2, "work", "{}");
    const audit = db.prepare(
      "INSERT INTO audits (id, type, action, metadata) VALUES (?, ?, ?, ?)",
    );
    audit.run(
      1,
      "project",
      "capability",
      '{"capability":"work","enabled":true}',
    );
    audit.run(
      2,
      "project",
      "capability",
      '{"capability":"knowledge","enabled":false}',
    );
    audit.run(
      3,
      "project",
      "capability",
      '{"capability":"apps","enabled":true}',
    );
    audit.run(
      4,
      "project",
      "capability",
      '{"capability":"support","enabled":true}',
    );
    // Not a capability event, though its metadata says `work`: untouched.
    audit.run(5, "project", "update", '{"capability":"work"}');
    // A malformed row must not abort the migration.
    audit.run(6, "project", "capability", "not json");
    audit.run(7, "project", "capability", null);
    return db;
  };

  const keys = (db: any) =>
    db
      .prepare(
        "SELECT project_id, key, options FROM project_capabilities ORDER BY id",
      )
      .all()
      .map((row: any) => [row.project_id, row.key, JSON.parse(row.options)]);

  const metadata = (db: any) =>
    db
      .prepare("SELECT id, metadata FROM audits ORDER BY id")
      .all()
      .map((row: any) => [row.id, row.metadata]);

  it("renames work, knowledge and apps, and keeps every option as it was", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(keys(db)).toStrictEqual([
      [1, "plan", { epics: true, board: false }],
      [1, "remember", { agentSummary: true }],
      [1, "ship", { track: true, deploy: true }],
      [1, "support", {}],
      [2, "plan", {}],
    ]);
  });

  it("rewrites the capability named by a capability audit row, and nothing else", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(metadata(db)).toStrictEqual([
      [1, '{"capability":"plan","enabled":true}'],
      [2, '{"capability":"remember","enabled":false}'],
      [3, '{"capability":"ship","enabled":true}'],
      [4, '{"capability":"support","enabled":true}'],
      [5, '{"capability":"work"}'],
      [6, "not json"],
      [7, null],
    ]);
  });

  it("changes nothing on a second run", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    const once = [keys(db), metadata(db)];
    db.exec(sql);

    expect([keys(db), metadata(db)]).toStrictEqual(once);
  });
});
