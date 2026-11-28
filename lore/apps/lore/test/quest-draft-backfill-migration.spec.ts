import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The migration that makes a draft epic's to-do quests drafts (#Q4373, epic
 * #E178): no `accepted_at` and no `completed_at`, shelved and held ones
 * included, `draft_at` taken from `created_at`. The count it touches is the
 * open quests the backlog gate hid (draft epics, not completed, not shelved)
 * plus the shelved quests of draft epics nobody accepted.
 */
describe("quest draft backfill migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261128170002_quest_draft_backfill/migration.sql",
    ),
    "utf8",
  );

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE epics (id integer PRIMARY KEY, status text NOT NULL, deleted_at integer)",
    );
    db.exec(
      "CREATE TABLE quests (id integer PRIMARY KEY, epic_id integer, created_at integer NOT NULL, deleted_at integer, accepted_at integer, completed_at integer, shelved_at integer, held_at integer, draft_at integer)",
    );
    db.exec(`INSERT INTO epics (id, status, deleted_at) VALUES
      (1, 'draft', NULL),
      (2, 'ready', NULL),
      (3, 'draft', 5)`);
    db.exec(`INSERT INTO quests (id, epic_id, created_at, deleted_at, accepted_at, completed_at, shelved_at, held_at) VALUES
      (10, 1, 100, NULL, NULL, NULL, NULL, NULL),
      (11, 1, 101, NULL, NULL, NULL, 200, NULL),
      (12, 1, 102, NULL, NULL, NULL, NULL, 200),
      (13, 1, 103, NULL, NULL, 300, NULL, NULL),
      (14, 1, 104, NULL, 250, NULL, NULL, NULL),
      (15, 1, 105, 9, NULL, NULL, NULL, NULL),
      (20, 2, 106, NULL, NULL, NULL, NULL, NULL),
      (30, 3, 107, NULL, NULL, NULL, NULL, NULL),
      (40, NULL, 108, NULL, NULL, NULL, NULL, NULL)`);
    return db;
  };

  const draftAt = (db: any) =>
    Object.fromEntries(
      db
        .prepare("SELECT id, draft_at FROM quests ORDER BY id")
        .all()
        .map((row: any) => [row.id, row.draft_at]),
    );

  it("drafts a draft epic's to-do, shelved and held quests, and nothing else", ({
    expect,
  }) => {
    const db = seeded();
    const hidden = db
      .prepare(
        "SELECT count(*) AS n FROM quests WHERE deleted_at IS NULL AND completed_at IS NULL AND shelved_at IS NULL AND epic_id IN (SELECT id FROM epics WHERE status = 'draft' AND deleted_at IS NULL)",
      )
      .get().n;
    const shelved = db
      .prepare(
        "SELECT count(*) AS n FROM quests WHERE deleted_at IS NULL AND completed_at IS NULL AND accepted_at IS NULL AND shelved_at IS NOT NULL AND epic_id IN (SELECT id FROM epics WHERE status = 'draft' AND deleted_at IS NULL)",
      )
      .get().n;

    db.exec(sql);

    expect(draftAt(db)).toEqual({
      10: 100,
      11: 101,
      12: 102,
      13: null,
      14: null,
      15: null,
      20: null,
      30: null,
      40: null,
    });
    // The gate's hidden open quests (10, 12, and 14, which is accepted and
    // so stays in progress) less the accepted one, plus the shelved one.
    const touched = Object.values(draftAt(db)).filter((v) => v != null);
    expect(touched).toHaveLength(hidden - 1 + shelved);
  });

  it("is a no-op the second time", ({ expect }) => {
    const db = seeded();
    db.exec(sql);
    const once = draftAt(db);
    db.exec(sql);
    expect(draftAt(db)).toEqual(once);
  });
});
