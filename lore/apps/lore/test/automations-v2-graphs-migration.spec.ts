import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Alepha } from "alepha";
import { NotificationSenderService } from "alepha/api/notifications";
import { afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Automations v2 (#E155, #Q3805): v1 rules are dropped, not migrated. The
 * migration, applied for real, deletes every rule, run, receipt and pending
 * event in an order RESTRICT allows, keeps channels, shared variables and
 * dispatched events, and drops the step index column.
 */
describe("automations v2 graphs migration", () => {
  const migration = (dialect: "sqlite" | "postgres", name: string) =>
    readFileSync(
      join(
        import.meta.dirname,
        `../migrations/${dialect}/${name}/migration.sql`,
      ),
      "utf8",
    );
  let alepha: Alepha | undefined;
  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("deletes rules, runs, receipts and pending events, and keeps channels and variables", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE automations (id text PRIMARY KEY, rule text NOT NULL, deleted_at text);
      CREATE TABLE automation_runs (id text PRIMARY KEY, automation_id text NOT NULL REFERENCES automations(id) ON DELETE RESTRICT);
      CREATE TABLE automation_receipts (id text PRIMARY KEY, automation_id text REFERENCES automations(id) ON DELETE RESTRICT, action_index integer, node_id text);
      CREATE TABLE automation_events (id text PRIMARY KEY, dispatched_at text);
      CREATE TABLE notification_channels (id text PRIMARY KEY);
      CREATE TABLE automation_variables (id text PRIMARY KEY);
      INSERT INTO automations VALUES ('live', '{"version":1}', NULL), ('gone', '{"version":1}', '2026-11-01');
      INSERT INTO automation_runs VALUES ('run', 'live'), ('old', 'gone');
      INSERT INTO automation_receipts VALUES ('occurrence', 'live', NULL, NULL), ('action', 'live', 0, NULL), ('origin', NULL, NULL, NULL);
      INSERT INTO automation_events VALUES ('pending', NULL), ('dispatched', '2026-11-16');
      INSERT INTO notification_channels VALUES ('discord');
      INSERT INTO automation_variables VALUES ('threshold');
    `);
    db.exec(migration("sqlite", "20261117120004_automations_v2_graphs"));
    const count = (table: string) =>
      db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    expect(count("automations")).toBe(0);
    expect(count("automation_runs")).toBe(0);
    expect(count("automation_receipts")).toBe(0);
    expect(db.prepare("SELECT id FROM automation_events").all()).toEqual([
      { id: "dispatched" },
    ]);
    expect(count("notification_channels")).toBe(1);
    expect(count("automation_variables")).toBe(1);
    expect(
      db
        .prepare("SELECT name FROM pragma_table_info('automation_receipts')")
        .all()
        .map((row: { name: string }) => row.name),
    ).toEqual(["id", "automation_id", "node_id"]);
  });

  it("writes the same statements, in the same order, for Postgres", ({
    expect,
  }) => {
    const statements = (sql: string) =>
      sql
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n")
        .split("--> statement-breakpoint")
        .map((statement) =>
          statement.replace(/[`"]/g, "").replace(/\s+/g, " ").trim(),
        );
    expect(
      statements(migration("postgres", "20261117120020_automations_v2_graphs")),
    ).toEqual(
      statements(migration("sqlite", "20261117120004_automations_v2_graphs")),
    );
  });

  it("skips, and does not fail, a notification queued by a deleted run", async ({
    expect,
  }) => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    });
    bootLore(alepha);
    await alepha.start();
    const result = await alepha.inject(NotificationSenderService).send({
      type: "inbox",
      template: "automation",
      contact: "lore-user:00000000-0000-4000-8000-000000000000",
      variables: {
        title: "Host offline",
        text: "host-1 stopped reporting",
        html: "host-1 stopped reporting",
        href: "/acme",
        projectTitle: "Acme",
        scope: "project:1",
        automationId: crypto.randomUUID(),
        ruleRevision: 3,
        nodeId: "action-1",
        sourceNode: "source",
        recipientUserId: "00000000-0000-4000-8000-000000000000",
        channelId: "inbox",
        category: "automations",
      },
      category: "automations",
      critical: false,
      sensitive: true,
      lang: "en",
    } as never);
    expect(result).toMatchObject({ skipped: "unavailable" });
  });
});
