import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that trusts the server error groups reported before a server
 * group was trusted on arrival (#Q4255).
 *
 * Every database the suite builds starts empty, with no group written while
 * every new one started untrusted: this spec seeds such rows and applies the
 * SQL for real.
 */
describe("server errors trusted migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261124145153_server_errors_trusted/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE project_errors (id integer PRIMARY KEY, fingerprint text NOT NULL, origin text NOT NULL, first_seen_at text NOT NULL, trusted_at text, trusted_by text)",
    );
    const row = db.prepare(
      "INSERT INTO project_errors (id, fingerprint, origin, first_seen_at, trusted_at, trusted_by) VALUES (?, ?, ?, ?, ?, ?)",
    );
    row.run(1, "abc", "server", "2026-11-20T10:00:00.000Z", null, null);
    row.run(2, "def", "client", "2026-11-20T11:00:00.000Z", null, null);
    row.run(3, "uptime:1:m", "server", "2026-11-20T12:00:00.000Z", null, null);
    row.run(4, "ghi", "run", "2026-11-20T13:00:00.000Z", null, null);
    row.run(
      5,
      "jkl",
      "server",
      "2026-11-20T14:00:00.000Z",
      "2026-11-21T09:00:00.000Z",
      "11111111-1111-4111-8111-111111111111",
    );
    return db;
  };

  const trust = (db: any) =>
    Object.fromEntries(
      db
        .prepare(
          "SELECT id, trusted_at, trusted_by FROM project_errors ORDER BY id",
        )
        .all()
        .map((r: any) => [r.id, [r.trusted_at, r.trusted_by]]),
    );

  it("trusts a server group at its first sighting, by no member", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);
    expect(trust(db)[1]).toEqual(["2026-11-20T10:00:00.000Z", null]);
  });

  it("leaves browser, uptime and run groups, and a member's trust, as they were", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);
    const after = trust(db);
    expect(after[2]).toEqual([null, null]);
    expect(after[3]).toEqual([null, null]);
    expect(after[4]).toEqual([null, null]);
    expect(after[5]).toEqual([
      "2026-11-21T09:00:00.000Z",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
});
