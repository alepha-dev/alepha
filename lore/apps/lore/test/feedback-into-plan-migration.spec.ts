import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that folds the Support capability into Plan as the option
 * `plan.feedback` (#E143, #Q3502), applied for real to rows in each shape
 * production can hold after the pillar rename.
 */
describe("feedback into plan migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261114102725_feedback_into_plan/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE project_capabilities (id integer PRIMARY KEY AUTOINCREMENT, project_id integer NOT NULL, key text NOT NULL, enabled_at integer NOT NULL DEFAULT 0, options text DEFAULT '{}' NOT NULL)",
    );
    db.exec(
      "CREATE UNIQUE INDEX project_capabilities_project_id_key_idx ON project_capabilities (project_id, key)",
    );
    db.exec(
      "CREATE TABLE audits (id integer PRIMARY KEY, type text NOT NULL, action text NOT NULL, metadata text)",
    );
    const capability = db.prepare(
      "INSERT INTO project_capabilities (project_id, key, enabled_at, options) VALUES (?, ?, ?, ?)",
    );
    // 1: Support and Plan.
    capability.run(1, "plan", 10, JSON.stringify({ epics: true }));
    capability.run(1, "support", 11, "{}");
    capability.run(1, "remember", 12, "{}");
    // 2: Support, no Plan.
    capability.run(2, "support", 20, "{}");
    capability.run(2, "ship", 21, JSON.stringify({ track: true }));
    // 3: Plan, no Support: feedback stays off.
    capability.run(3, "plan", 30, JSON.stringify({ releases: true }));
    // 4: nothing to fold.
    capability.run(4, "remember", 40, "{}");
    const audit = db.prepare(
      "INSERT INTO audits (id, type, action, metadata) VALUES (?, ?, ?, ?)",
    );
    audit.run(
      1,
      "project",
      "capability",
      '{"capability":"support","enabled":true}',
    );
    audit.run(
      2,
      "project",
      "capability",
      '{"capability":"support","enabled":false}',
    );
    audit.run(
      3,
      "project",
      "capability",
      '{"capability":"plan","enabled":true}',
    );
    audit.run(4, "project", "capability", "not json");
    return db;
  };

  const rows = (db: any) =>
    db
      .prepare(
        "SELECT project_id, key, enabled_at, options FROM project_capabilities ORDER BY project_id, key",
      )
      .all()
      .map((row: any) => [
        row.project_id,
        row.key,
        row.enabled_at,
        JSON.parse(row.options),
      ]);

  const metadata = (db: any) =>
    db
      .prepare("SELECT id, metadata FROM audits ORDER BY id")
      .all()
      .map((row: any) => [
        row.id,
        row.metadata === "not json" ? row.metadata : JSON.parse(row.metadata),
      ]);

  it("turns feedback on in Plan where Support was on, keeping every other option", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(rows(db).filter((row: any[]) => row[0] === 1)).toStrictEqual([
      [1, "plan", 10, { epics: true, feedback: true }],
      [1, "remember", 12, {}],
    ]);
  });

  it("turns Plan on with feedback alone where Support was on and Plan off", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(rows(db).filter((row: any[]) => row[0] === 2)).toStrictEqual([
      [2, "plan", 20, { feedback: true }],
      [2, "ship", 21, { track: true }],
    ]);
  });

  it("leaves a project without Support as it was, and no Support row anywhere", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(rows(db).filter((row: any[]) => row[0] >= 3)).toStrictEqual([
      [3, "plan", 30, { releases: true }],
      [4, "remember", 40, {}],
    ]);
    expect(rows(db).some((row: any[]) => row[1] === "support")).toBe(false);
  });

  it("rewrites a Support audit row as the Feedback option of Plan", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(metadata(db)).toStrictEqual([
      [1, { capability: "plan", enabled: true, option: "feedback" }],
      [2, { capability: "plan", enabled: false, option: "feedback" }],
      [3, { capability: "plan", enabled: true }],
      [4, "not json"],
    ]);
  });

  it("changes nothing on a second run", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    const once = [rows(db), metadata(db)];
    db.exec(sql);

    expect([rows(db), metadata(db)]).toStrictEqual(once);
  });
});
