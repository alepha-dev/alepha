import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that gives every ended job that ran a start time (#Q4432):
 * its command's `running_at`, else its `sent_at`, else, for a job its host
 * says ran, its `queued_at`. A job that never ran keeps none.
 */
describe("job started_at backfill migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261126233657_job_started_at_backfill/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE host_commands (id text PRIMARY KEY, sent_at text, running_at text)",
    );
    db.exec(
      "CREATE TABLE host_jobs (id text PRIMARY KEY, status text NOT NULL, command_id text, queued_at text NOT NULL, started_at text, ended_at text)",
    );
    db.exec(`INSERT INTO host_commands (id, sent_at, running_at) VALUES
      ('c-running', '2026-11-25T10:00:01Z', '2026-11-25T10:00:02Z'),
      ('c-sent', '2026-11-25T10:00:01Z', NULL),
      ('c-never', NULL, NULL)`);
    db.exec(`INSERT INTO host_jobs (id, status, command_id, queued_at, started_at, ended_at) VALUES
      ('from-running', 'succeeded', 'c-running', '2026-11-25T10:00:00Z', NULL, '2026-11-25T11:00:00Z'),
      ('from-sent', 'failed', 'c-sent', '2026-11-25T10:00:00Z', NULL, '2026-11-25T11:00:00Z'),
      ('pruned', 'timed_out', NULL, '2026-11-25T10:00:00Z', NULL, '2026-11-25T11:00:00Z'),
      ('never-sent', 'failed', 'c-never', '2026-11-25T10:00:00Z', NULL, '2026-11-25T11:00:00Z'),
      ('cancelled-queued', 'cancelled', NULL, '2026-11-25T10:00:00Z', NULL, '2026-11-25T11:00:00Z'),
      ('kept', 'succeeded', 'c-running', '2026-11-25T10:00:00Z', '2026-11-25T10:30:00Z', '2026-11-25T11:00:00Z'),
      ('still-running', 'running', 'c-sent', '2026-11-25T10:00:00Z', NULL, NULL)`);
    return db;
  };

  const startedAt = (db: any) =>
    Object.fromEntries(
      db
        .prepare("SELECT id, started_at FROM host_jobs ORDER BY id")
        .all()
        .map((row: any) => [row.id, row.started_at]),
    );

  it("fills each ended job from its command, else its queue time when it ran, and leaves a job that never ran", ({
    expect,
  }) => {
    const db = seeded();
    db.exec(sql);

    expect(startedAt(db)).toEqual({
      "from-running": "2026-11-25T10:00:02Z",
      "from-sent": "2026-11-25T10:00:01Z",
      pruned: "2026-11-25T10:00:00Z",
      "never-sent": null,
      "cancelled-queued": null,
      kept: "2026-11-25T10:30:00Z",
      "still-running": null,
    });
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    const once = startedAt(db);
    db.exec(sql);
    expect(startedAt(db)).toEqual(once);
  });
});
