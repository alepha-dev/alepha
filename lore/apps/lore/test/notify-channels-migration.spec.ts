import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that turns a stored rule's notify `channel` into
 * `channels` (#Q3613), applied for real.
 */
describe("notify channels migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261115043131_notify_channels/migration.sql",
    ),
    "utf8",
  );

  it("rewrites every notify to a channel list, keeps order and other actions", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE automations (id text PRIMARY KEY, rule text NOT NULL)",
    );
    const insert = db.prepare("INSERT INTO automations VALUES (?, ?)");
    insert.run(
      "a",
      JSON.stringify({
        version: 1,
        actions: [
          { kind: "appendFolio", folio: "f", text: "t" },
          { kind: "notify", recipient: "u", channel: "email", title: "x" },
          { kind: "notify", recipient: "u", channel: "inbox", title: "y" },
        ],
      }),
    );
    insert.run(
      "b",
      JSON.stringify({
        version: 1,
        actions: [{ kind: "notify", channels: ["inbox"], title: "z" }],
      }),
    );
    db.exec(sql);
    const rule = (id: string) =>
      JSON.parse(
        db.prepare("SELECT rule FROM automations WHERE id = ?").get(id).rule,
      );
    expect(rule("a").actions).toEqual([
      { kind: "appendFolio", folio: "f", text: "t" },
      { kind: "notify", recipient: "u", channels: ["email"], title: "x" },
      { kind: "notify", recipient: "u", channels: ["inbox"], title: "y" },
    ]);
    expect(rule("b").actions).toEqual([
      { kind: "notify", channels: ["inbox"], title: "z" },
    ]);
  });
});
