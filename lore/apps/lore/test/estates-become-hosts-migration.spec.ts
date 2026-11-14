import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * Estate becomes host (#E147, #Q3555): the tables and columns are renamed,
 * and every identifier a row stores is rewritten in the same migration.
 *
 * Every database the suite builds is created from the entities, so no other
 * spec ever holds a row written before the rename. This one builds the
 * schema from the migrations that precede it, seeds each stored identifier
 * in its old spelling, and applies the SQL for real.
 */
describe("estates become hosts migration", () => {
  const MIGRATION = "20261114004743_estates_become_hosts";
  const dir = join(import.meta.dirname, "../migrations/sqlite");
  const sqlOf = (name: string) =>
    readFileSync(join(dir, name, "migration.sql"), "utf8");
  const before = readdirSync(dir)
    .filter((name) => /^\d{14}_/.test(name) && name < MIGRATION)
    .sort();

  const exec = (db: any, sql: string) => {
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  };

  /**
   * Inserts one row, filling every NOT NULL column without a default that
   * the caller left out, so a seed names only what the spec is about.
   */
  const insert = (db: any, table: string, row: Record<string, unknown>) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;
    const full: Record<string, unknown> = { ...row };
    for (const column of columns) {
      if (column.name in full) continue;
      if (!column.notnull || column.dflt_value !== null || column.pk) continue;
      full[column.name] = /int/i.test(column.type) ? 0 : "x";
    }
    const names = Object.keys(full);
    db.prepare(
      `INSERT INTO ${table} (${names.map((n) => `\`${n}\``).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    ).run(...names.map((n) => full[n] as any));
  };

  const migrated = () => {
    const db: any = new DatabaseSync(":memory:", {
      enableForeignKeyConstraints: false,
    });
    for (const name of before) exec(db, sqlOf(name));

    const host = "6f1c2f9a-2b5e-4c1d-9a3e-8d7b6c5a4f30";
    insert(db, "estates", { id: host, project_id: 1, slug: "ovh-1" });
    insert(db, "estate_projects", { id: 1, estate_id: host, project_id: 2 });
    insert(db, "estate_inventories", {
      id: 1,
      estate_id: host,
      host: JSON.stringify({ cores: 4 }),
    });
    insert(db, "app_instances", { id: "i1", estate_id: host });
    insert(db, "sigils", { id: "s1", last_seen_host: "app.example.com" });
    insert(db, "analytics_estate_stats_rolled", {
      time_bucket: "2026-11-01",
      estate_id: host,
    });
    insert(db, "organization_ranks", {
      id: "r1",
      key: "r1",
      permissions: JSON.stringify(["quest:read", "estate:read", "estate:lend"]),
    });
    insert(db, "organization_ranks", {
      id: "r2",
      key: "r2",
      permissions: JSON.stringify(["estate:*"]),
    });
    insert(db, "api_keys", {
      id: "k1",
      permissions: JSON.stringify(["estate:read", "estate:update"]),
    });
    insert(db, "audits", { id: 1, type: "estate", resource_type: "estate" });
    insert(db, "notification_inbox", {
      id: "n1",
      template: "lore:estate:overdue",
      category: "estates",
    });
    insert(db, "notification_preferences", {
      id: 1,
      muted_categories: JSON.stringify(["estates", "quests"]),
    });
    insert(db, "analytics_prune_floors", {
      dataset: "estate_stats",
      floor: "2026-10-01",
    });
    insert(db, "parameters", {
      id: "p1",
      name: "lore.campaign.limits",
      content: JSON.stringify({ maxProjectsPerUser: 5, maxCommandsPerEstate: 50 }),
    });

    exec(db, sqlOf(MIGRATION));
    return { db, host };
  };

  const one = (db: any, sql: string) => db.prepare(sql).get();

  it("renames the tables and their host columns, rows kept", ({ expect }) => {
    const { db, host } = migrated();

    expect(one(db, "SELECT id, slug FROM hosts")).toEqual({
      id: host,
      slug: "ovh-1",
    });
    expect(one(db, "SELECT host_id FROM host_projects").host_id).toBe(host);
    expect(one(db, "SELECT host_id FROM app_instances").host_id).toBe(host);
    expect(
      one(db, "SELECT host_id FROM analytics_host_stats_rolled").host_id,
    ).toBe(host);
  });

  it("stores the inventory's machine block as machine, and a hostname as last_seen_hostname", ({
    expect,
  }) => {
    const { db, host } = migrated();

    const inventory = one(db, "SELECT host_id, machine FROM host_inventories");
    expect(inventory.host_id).toBe(host);
    expect(JSON.parse(inventory.machine)).toEqual({ cores: 4 });
    expect(one(db, "SELECT last_seen_hostname FROM sigils")).toEqual({
      last_seen_hostname: "app.example.com",
    });
  });

  it("rewrites permissions, exact and wildcard, in ranks and keys", ({
    expect,
  }) => {
    const { db } = migrated();
    const permissions = (table: string, id: string) =>
      JSON.parse(
        one(db, `SELECT permissions FROM ${table} WHERE id = '${id}'`)
          .permissions,
      );

    expect(permissions("organization_ranks", "r1")).toEqual([
      "quest:read",
      "host:read",
      "host:lend",
    ]);
    expect(permissions("organization_ranks", "r2")).toEqual(["host:*"]);
    expect(permissions("api_keys", "k1")).toEqual(["host:read", "host:update"]);
  });

  it("moves audits, notifications, the stats prune floor and the limits parameter to the new names", ({
    expect,
  }) => {
    const { db } = migrated();

    expect(one(db, "SELECT type, resource_type FROM audits")).toEqual({
      type: "host",
      resource_type: "host",
    });
    expect(
      one(db, "SELECT template, category FROM notification_inbox"),
    ).toEqual({ template: "lore:host:overdue", category: "hosts" });
    expect(
      JSON.parse(
        one(db, "SELECT muted_categories FROM notification_preferences")
          .muted_categories,
      ),
    ).toEqual(["hosts", "quests"]);
    expect(one(db, "SELECT dataset FROM analytics_prune_floors").dataset).toBe(
      "host_stats",
    );
    expect(
      JSON.parse(one(db, "SELECT content FROM parameters").content),
    ).toEqual({ maxProjectsPerUser: 5, maxCommandsPerHost: 50 });
  });
});
