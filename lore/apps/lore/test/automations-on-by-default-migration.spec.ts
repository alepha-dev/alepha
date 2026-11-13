import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The backfill that turns Automations on for projects created before it was
 * on by default (#Q3563).
 *
 * `CapabilityRegistry.optionsOf` reads an option a row never stored as off,
 * so the new `preselected` reaches new projects only. Every database the
 * suite builds is empty, so no other spec sees an old row: this one seeds
 * Work rows in each shape production holds and applies the SQL for real.
 */
describe("automations on by default migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261113171047_automations_on_by_default/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE project_capabilities (id integer PRIMARY KEY, project_id integer, key text, options text DEFAULT '{}' NOT NULL)",
    );
    const insert = db.prepare(
      "INSERT INTO project_capabilities (id, project_id, key, options) VALUES (?, ?, ?, ?)",
    );
    // Never stored: turned on, every other option kept.
    insert.run(1, 1, "work", JSON.stringify({ board: true, epics: false }));
    insert.run(2, 2, "work", "{}");
    // An owner turned it off: stays off.
    insert.run(3, 3, "work", JSON.stringify({ automations: false }));
    // Already on: untouched.
    insert.run(4, 4, "work", JSON.stringify({ automations: true }));
    // Another capability: untouched.
    insert.run(5, 1, "apps", JSON.stringify({ track: true }));
    return db;
  };

  const optionsOf = (db: any, id: number) =>
    JSON.parse(
      db
        .prepare("SELECT options FROM project_capabilities WHERE id = ?")
        .get(id).options,
    );

  it("turns Automations on where a Work row never stored it, as a JSON boolean", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(optionsOf(db, 1)).toStrictEqual({
      board: true,
      epics: false,
      automations: true,
    });
    expect(optionsOf(db, 2)).toStrictEqual({ automations: true });
  });

  it("keeps an explicit off, an explicit on, and other capabilities as they were", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(optionsOf(db, 3)).toStrictEqual({ automations: false });
    expect(optionsOf(db, 4)).toStrictEqual({ automations: true });
    expect(optionsOf(db, 5)).toStrictEqual({ track: true });
  });

  it("changes nothing on a second run", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    const once = [1, 2, 3, 4, 5].map((id) => optionsOf(db, id));
    db.exec(sql);

    expect([1, 2, 3, 4, 5].map((id) => optionsOf(db, id))).toStrictEqual(once);
  });
});
