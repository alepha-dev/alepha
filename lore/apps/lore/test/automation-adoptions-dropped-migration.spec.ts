import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { automationRuleSchema } from "@lore/core/schemas";
import { describe, it } from "vitest";

/**
 * The migration that removes adoption (#Q3628), applied for real: a rule
 * adopted before it loses its `compatibility` key, stays enabled, and is a
 * rule the strict schema accepts again, so it keeps running.
 */
describe("automation adoptions dropped migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261115062330_automation_adoptions_dropped/migration.sql",
    ),
    "utf8",
  );
  const adopted = {
    version: 1,
    compatibility: "quest-reminders",
    trigger: { kind: "schedule", cron: "0 * * * *" },
    select: { kind: "rows", key: "quests.remindersDue", filters: {} },
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: "{{assignee_id}}",
        channels: ["email"],
        category: "reminders",
        title: "Quest reminder",
        text: "{{title}}",
      },
    ],
  };

  it("strips compatibility from rules, runs and receipts, keeps the rule enabled, and drops the table", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE automations (id text PRIMARY KEY, enabled integer NOT NULL, rule text NOT NULL);
      CREATE TABLE automation_runs (id text PRIMARY KEY, snapshot text NOT NULL);
      CREATE TABLE automation_receipts (id text PRIMARY KEY, snapshot text);
      CREATE TABLE automation_adoptions (id text PRIMARY KEY, project_id integer, policy text, automation_id text);
      CREATE UNIQUE INDEX automation_adoptions_project_id_policy_idx ON automation_adoptions (project_id, policy);
      CREATE INDEX automation_adoptions_automation_id_idx ON automation_adoptions (automation_id);
    `);
    const snapshot = JSON.stringify({ rule: adopted, revision: 3 });
    db.prepare("INSERT INTO automations VALUES (?, ?, ?)").run(
      "adopted",
      1,
      JSON.stringify(adopted),
    );
    db.prepare("INSERT INTO automation_runs VALUES (?, ?)").run(
      "run",
      snapshot,
    );
    db.prepare("INSERT INTO automation_receipts VALUES (?, ?)").run(
      "receipt",
      snapshot,
    );
    db.prepare("INSERT INTO automation_receipts VALUES (?, ?)").run(
      "bare",
      null,
    );
    db.prepare("INSERT INTO automation_adoptions VALUES (?, ?, ?, ?)").run(
      "marker",
      1,
      "quest-reminders",
      "adopted",
    );
    expect(automationRuleSchema.safeParse(adopted).success).toBe(false);

    db.exec(sql);

    const row = db
      .prepare("SELECT enabled, rule FROM automations WHERE id = 'adopted'")
      .get();
    const rule = JSON.parse(row.rule);
    expect(row.enabled).toBe(1);
    expect(rule).not.toHaveProperty("compatibility");
    expect(automationRuleSchema.parse(rule)).toMatchObject({
      select: { key: "quests.remindersDue" },
    });
    const run = JSON.parse(
      db.prepare("SELECT snapshot FROM automation_runs").get().snapshot,
    );
    expect(run.rule).not.toHaveProperty("compatibility");
    expect(run.revision).toBe(3);
    const receipt = JSON.parse(
      db
        .prepare(
          "SELECT snapshot FROM automation_receipts WHERE id = 'receipt'",
        )
        .get().snapshot,
    );
    expect(receipt.rule).not.toHaveProperty("compatibility");
    expect(
      db
        .prepare("SELECT snapshot FROM automation_receipts WHERE id = 'bare'")
        .get().snapshot,
    ).toBeNull();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name LIKE 'automation_adoptions%'",
        )
        .all(),
    ).toEqual([]);
  });
});
