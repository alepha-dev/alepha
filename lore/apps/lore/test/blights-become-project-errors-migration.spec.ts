import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * Blight becomes error (#E147, #Q3552): the tables are renamed, and every
 * identifier a row stores is rewritten in the same migration.
 *
 * Every database the suite builds is created from the entities, so no other
 * spec ever holds a row written before the rename. This one builds the
 * schema from the migrations that precede it, seeds each stored identifier
 * in its old spelling, and applies the SQL for real.
 */
describe("blights become project errors migration", () => {
  const MIGRATION = "20261114021313_errors_and_hosts";
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

    insert(db, "blights", {
      id: 7,
      project_id: 1,
      fingerprint: "f",
      name: "TypeError",
      message: "boom",
      first_seen_at: "2026-11-01",
      last_seen_at: "2026-11-02",
      status: "quest:12",
    });
    insert(db, "blight_ignore_rules", { id: 3, project_id: 1, pattern: "x" });
    insert(db, "organization_ranks", {
      id: "r1",
      key: "r1",
      permissions: JSON.stringify([
        "quest:read",
        "blight:read",
        "blight:triage",
      ]),
    });
    insert(db, "organization_ranks", {
      id: "r2",
      key: "r2",
      permissions: JSON.stringify(["blight:*", "folio:*"]),
    });
    insert(db, "api_keys", {
      id: "k1",
      permissions: JSON.stringify(["blight:read"]),
    });
    insert(db, "dashboard_cards", { id: 1, metric: "openBlights" });
    insert(db, "project_dashboard_cards", { id: 2, metric: "openBlights" });
    insert(db, "automations", {
      id: "a1",
      preset_key: "blight-crossing",
      rule: JSON.stringify({
        version: 1,
        select: { kind: "scalar", key: "openBlights", filters: {} },
      }),
    });
    insert(db, "sigils", {
      id: "s1",
      kinds: JSON.stringify(["feedback", "blights", "beacon"]),
    });
    insert(db, "project_prompts", {
      id: 1,
      project_id: 1,
      kind: "blightTriage",
      template: "t",
    });
    insert(db, "quests", {
      id: 12,
      short_id: 12,
      project_id: 1,
      area: "Blights",
      source: JSON.stringify({ sigilBlightId: 7 }),
    });
    insert(db, "quests", {
      id: 13,
      short_id: 13,
      project_id: 2,
      area: "Blights",
    });
    insert(db, "quests", {
      id: 14,
      short_id: 14,
      project_id: 1,
      area: "Errors",
    });
    insert(db, "areas", { id: 1, project_id: 1, name: "Blights" });
    insert(db, "areas", { id: 2, project_id: 1, name: "Errors" });
    insert(db, "areas", { id: 3, project_id: 2, name: "Blights" });

    exec(db, sqlOf(MIGRATION));
    return db;
  };

  const one = (db: any, sql: string) => db.prepare(sql).get();
  const all = (db: any, sql: string) => db.prepare(sql).all();

  it("renames both tables and keeps their rows", ({ expect }) => {
    const db = migrated();

    expect(one(db, "SELECT id, status FROM project_errors")).toEqual({
      id: 7,
      status: "quest:12",
    });
    expect(one(db, "SELECT id FROM project_error_ignore_rules")).toEqual({
      id: 3,
    });
  });

  it("rewrites permissions, exact and wildcard, in ranks and keys", ({
    expect,
  }) => {
    const db = migrated();
    const permissions = (table: string, id: string) =>
      JSON.parse(
        one(db, `SELECT permissions FROM ${table} WHERE id = '${id}'`)
          .permissions,
      );

    expect(permissions("organization_ranks", "r1")).toEqual([
      "quest:read",
      "error:read",
      "error:triage",
    ]);
    expect(permissions("organization_ranks", "r2")).toEqual([
      "error:*",
      "folio:*",
    ]);
    expect(permissions("api_keys", "k1")).toEqual(["error:read"]);
  });

  it("moves the metric, the automation rule and its preset to openErrors", ({
    expect,
  }) => {
    const db = migrated();

    expect(one(db, "SELECT metric FROM dashboard_cards").metric).toBe(
      "openErrors",
    );
    expect(one(db, "SELECT metric FROM project_dashboard_cards").metric).toBe(
      "openErrors",
    );
    const automation = one(db, "SELECT rule, preset_key FROM automations");
    expect(JSON.parse(automation.rule).select.key).toBe("openErrors");
    expect(automation.preset_key).toBe("error-crossing");
  });

  it("renames the sigil kind and the Triage prompt kind", ({ expect }) => {
    const db = migrated();

    expect(JSON.parse(one(db, "SELECT kinds FROM sigils").kinds)).toEqual([
      "feedback",
      "errors",
      "beacon",
    ]);
    expect(one(db, "SELECT kind FROM project_prompts").kind).toBe(
      "errorTriage",
    );
  });

  it("points a forwarded quest at its error as projectErrorId", ({
    expect,
  }) => {
    const db = migrated();

    expect(
      JSON.parse(one(db, "SELECT source FROM quests WHERE id = 12").source),
    ).toEqual({ projectErrorId: 7 });
  });

  it("renames the Blights area, merging it into an Errors area already there", ({
    expect,
  }) => {
    const db = migrated();

    expect(
      all(db, "SELECT id, project_id, name FROM areas ORDER BY id"),
    ).toEqual([
      { id: 2, project_id: 1, name: "Errors" },
      { id: 3, project_id: 2, name: "Errors" },
    ]);
    expect(
      all(db, "SELECT id, area FROM quests ORDER BY id").map(
        (row: { area: string }) => row.area,
      ),
    ).toEqual(["Errors", "Errors", "Errors"]);
  });
});
