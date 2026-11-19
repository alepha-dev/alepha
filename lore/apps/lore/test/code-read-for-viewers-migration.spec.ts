import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that gives the stored Viewer ranks nobody edited their
 * `code:read` (#E162, #Q3927). Admin and Member follow the code, so they need
 * none.
 *
 * Every database the suite builds starts from the entities, with no stored
 * rank written before `code:*` existed: this spec seeds such rows and applies
 * the SQL for real.
 */
describe("code:read for viewers migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261119144622_code_read_for_viewers/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE organization_ranks (id text PRIMARY KEY, version integer DEFAULT 0 NOT NULL, key text NOT NULL, permissions text NOT NULL)",
    );
    const rank = db.prepare(
      "INSERT INTO organization_ranks (id, version, key, permissions) VALUES (?, ?, ?, ?)",
    );
    rank.run("a", 0, "viewer", JSON.stringify(["project:read", "quest:read"]));
    // Edited by somebody: kept as it is.
    rank.run("b", 3, "viewer", JSON.stringify(["project:read"]));
    // Already holds it: not doubled.
    rank.run("c", 0, "viewer", JSON.stringify(["project:read", "code:read"]));
    // Not a Viewer.
    rank.run("d", 0, "admin", JSON.stringify(["project:read"]));
    rank.run("e", 0, "triage", JSON.stringify(["project:read"]));
    return db;
  };

  const permissionsOf = (db: any) =>
    Object.fromEntries(
      db
        .prepare("SELECT id, permissions FROM organization_ranks ORDER BY id")
        .all()
        .map((row: any) => [row.id, JSON.parse(row.permissions)]),
    );

  it("adds code:read to every Viewer nobody edited, once, and touches nothing else", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(permissionsOf(db)).toEqual({
      a: ["project:read", "quest:read", "code:read"],
      b: ["project:read"],
      c: ["project:read", "code:read"],
      d: ["project:read"],
      e: ["project:read"],
    });
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    const once = permissionsOf(db);
    db.exec(sql);

    expect(permissionsOf(db)).toEqual(once);
  });
});
