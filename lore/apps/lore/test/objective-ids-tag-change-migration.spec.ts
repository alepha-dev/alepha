import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/**
 * The data rewrite that let #E74 delete two legacy tolerances (#Q2619):
 * objectives without an `id`, and folio revisions labelled `tag-change`.
 *
 * Both are validated on read once their tolerance is gone, so a row this
 * migration misses fails the query that reads it. No other spec can see that:
 * every database the suite builds is empty. This one seeds the old shapes on
 * the two columns involved and applies the SQL for real.
 */
describe("objective ids and tag-change migration", () => {
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../migrations/sqlite/20261004234306_objective_ids_tag_change/migration.sql",
    ),
    "utf8",
  );

  const apply = (db: any) => {
    for (const raw of sql.split("--> statement-breakpoint")) {
      if (raw.trim()) db.exec(raw);
    }
  };

  const seeded = () => {
    const db: any = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE quests (id integer PRIMARY KEY, objectives text)");
    db.exec(
      "CREATE TABLE folio_revisions (id integer PRIMARY KEY, action text)",
    );
    const insert = db.prepare(
      "INSERT INTO quests (id, objectives) VALUES (?, ?)",
    );
    // No id at all: numbered by position, as the read path synthesized.
    insert.run(
      1,
      JSON.stringify([
        { title: "a", completed: false },
        { title: "b", completed: true },
        { title: "c", completed: false },
      ]),
    );
    // Mixed: the missing one takes its index, the others keep theirs.
    insert.run(
      2,
      JSON.stringify([
        { id: 7, title: "a", completed: false },
        { title: "b", completed: false, waivedReason: "no" },
      ]),
    );
    // Already whole, and empty: untouched.
    insert.run(3, JSON.stringify([{ id: 0, title: "a", completed: false }]));
    insert.run(4, "[]");
    db.exec(
      "INSERT INTO folio_revisions (id, action) VALUES (1, 'tag-change'), (2, 'rename'), (3, 'edit')",
    );
    return db;
  };

  const objectivesOf = (db: any, id: number) =>
    JSON.parse(
      db.prepare("SELECT objectives FROM quests WHERE id = ?").get(id)
        .objectives,
    );

  it("numbers id-less objectives by position, keeping order and every field", ({
    expect,
  }) => {
    const db = seeded();
    apply(db);

    expect(objectivesOf(db, 1)).toEqual([
      { title: "a", completed: false, id: 0 },
      { title: "b", completed: true, id: 1 },
      { title: "c", completed: false, id: 2 },
    ]);
    expect(objectivesOf(db, 2)).toEqual([
      { id: 7, title: "a", completed: false },
      { title: "b", completed: false, waivedReason: "no", id: 1 },
    ]);
    expect(objectivesOf(db, 3)).toEqual([
      { id: 0, title: "a", completed: false },
    ]);
    expect(objectivesOf(db, 4)).toEqual([]);
  });

  it("relabels tag-change revisions as edits and nothing else", ({
    expect,
  }) => {
    const db = seeded();
    apply(db);

    expect(
      db.prepare("SELECT id, action FROM folio_revisions ORDER BY id").all(),
    ).toEqual([
      { id: 1, action: "edit" },
      { id: 2, action: "rename" },
      { id: 3, action: "edit" },
    ]);
  });

  it("is idempotent", ({ expect }) => {
    const db = seeded();
    apply(db);
    const once = objectivesOf(db, 2);
    apply(db);

    expect(objectivesOf(db, 2)).toEqual(once);
  });
});
