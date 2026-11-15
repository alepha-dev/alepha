import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that makes every host's home project required (#Q3627),
 * applied for real. It rebuilds nothing: `hosts` has CASCADE and SET NULL
 * children, so it adds triggers that refuse a NULL, and aborts while any
 * host still has none rather than delete it.
 */
describe("hosts project required migration", () => {
  const statements = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261115015253_hosts_project_required/migration.sql",
    ),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  const seeded = (homeless: boolean) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("CREATE TABLE projects (id integer PRIMARY KEY)");
    db.exec(
      "CREATE TABLE hosts (id text PRIMARY KEY, project_id integer REFERENCES projects(id) ON DELETE RESTRICT, slug text NOT NULL)",
    );
    // Two children in the shapes the real ones have: cascade and set null.
    db.exec(
      "CREATE TABLE host_events (id integer PRIMARY KEY, host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE)",
    );
    db.exec(
      "CREATE TABLE app_instances (id integer PRIMARY KEY, host_id text REFERENCES hosts(id) ON DELETE SET NULL)",
    );
    db.exec("INSERT INTO projects (id) VALUES (1)");
    db.exec("INSERT INTO hosts VALUES ('h1', 1, 'one'), ('h2', 1, 'two')");
    if (homeless) db.exec("INSERT INTO hosts VALUES ('h3', NULL, 'three')");
    db.exec("INSERT INTO host_events (host_id) VALUES ('h1'), ('h2')");
    db.exec("INSERT INTO app_instances (host_id) VALUES ('h1'), ('h2')");
    return db;
  };
  const apply = (db: any) => {
    db.exec("BEGIN");
    try {
      for (const statement of statements) db.exec(statement);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const count = (db: any, sql: string) =>
    Number(Object.values(db.prepare(sql).get())[0]);

  it("applies when every host has a project, and keeps every child row", ({
    expect,
  }) => {
    const db = seeded(false);
    apply(db);
    expect(count(db, "SELECT count(*) FROM hosts")).toBe(2);
    expect(count(db, "SELECT count(*) FROM host_events")).toBe(2);
    expect(
      count(db, "SELECT count(*) FROM app_instances WHERE host_id IS NOT NULL"),
    ).toBe(2);
  });

  it("refuses a host with no project from then on, on insert and on update", ({
    expect,
  }) => {
    const db = seeded(false);
    apply(db);
    expect(() =>
      db.exec("INSERT INTO hosts VALUES ('h9', NULL, 'nine')"),
    ).toThrow("hosts.project_id is required");
    expect(() =>
      db.exec("UPDATE hosts SET project_id = NULL WHERE id = 'h1'"),
    ).toThrow("hosts.project_id is required");
    expect(count(db, "SELECT count(*) FROM hosts")).toBe(2);
  });

  it("refuses to run while a host has no project, deleting nothing", ({
    expect,
  }) => {
    const db = seeded(true);
    expect(() => apply(db)).toThrow("hosts.project_id is required");
    expect(count(db, "SELECT count(*) FROM hosts")).toBe(3);
    // Rolled back: no trigger was left behind.
    expect(
      count(db, "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'"),
    ).toBe(0);
  });
});
