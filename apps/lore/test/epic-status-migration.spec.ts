import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Resolved from this file, not from `process.cwd()`, for the reason
 * `project-slug-migration.spec.ts` gives: the two vitest configs run with
 * different working directories.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The migration that retired epic #31's `active` and `done` (#Q2223).
 *
 * `epics.status` is an enum validated on READ, so a row left holding a
 * retired value fails to decode and takes every epic query with it: the
 * 2026-08-05 incident's shape. No other spec can see that, because every
 * database the suite builds is empty, so every row it holds is already in the
 * new vocabulary. This one seeds the old shapes and applies the SQL for real.
 */
describe("epic four-status migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  /**
   * What the database executes, without the `--` prose around it, so the
   * guard below reads statements and not the comment explaining their
   * absence.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const target = migrations.find((name) =>
    statementsOf(name).includes("RENAME COLUMN `activated_at` TO `started_at`"),
  );

  it("exists", ({ expect }) => {
    expect(target).toBeDefined();
  });

  it("never drops a table", ({ expect }) => {
    // `epics` is the SET NULL parent of `quests.epic_id` and
    // `folios.epic_id`: a rebuild on D1 would detach every quest and folio
    // from its epic, silently.
    expect(statementsOf(target!)).not.toMatch(/DROP TABLE/i);
  });

  it("rewrites every epic into the new vocabulary when applied to real rows", ({
    expect,
  }) => {
    // better-sqlite3 is a native addon, so `createRequire` is how the vitest
    // ESM graph reaches it, as in `migration-safety.spec.ts`.
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    // D1 enforces foreign keys whatever the pragma says; so does this.
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    for (const dir of migrations.slice(0, migrations.indexOf(target!))) {
      apply(dir);
    }

    const owner = "00000000-0000-0000-0000-000000000001";
    db.prepare("INSERT INTO users (id) VALUES (?)").run(owner);
    db.prepare(
      "INSERT INTO projects (id, title, created_by) VALUES (1, 'P', ?)",
    ).run(owner);

    const epic = db.prepare(
      "INSERT INTO epics (id, project_id, number, title, status, activated_at, completed_at) VALUES (?, 1, ?, ?, ?, ?, ?)",
    );
    let shortId = 0;
    const quest = (
      epicId: number,
      columns: {
        completedAt?: number;
        shelvedAt?: number;
        deletedAt?: number;
      } = {},
    ) => {
      shortId += 1;
      db.prepare(
        "INSERT INTO quests (short_id, title, description, area, priority, project_id, created_by, epic_id, completed_at, shelved_at, deleted_at) VALUES (?, 'Q', '', 'general', 'medium', 1, ?, ?, ?, ?, ?)",
      ).run(
        shortId,
        owner,
        epicId,
        columns.completedAt ?? null,
        columns.shelvedAt ?? null,
        columns.deletedAt ?? null,
      );
    };

    const T0 = 1_756_000_000_000;
    const T1 = T0 + 60_000;
    const T2 = T0 + 120_000;

    // 1. Planned: untouched.
    epic.run(1, 1, "planned", "planned", null, null);
    // 2. Active with an open quest: in progress, start date kept.
    epic.run(2, 2, "working", "active", T0, null);
    quest(2);
    quest(2, { completedAt: T1 });
    // 3. Active with everything resolved: completed, at the LAST resolution
    //    (a shelve, which carries no `completed_at`).
    epic.run(3, 3, "finished", "active", T0, null);
    quest(3, { completedAt: T1 });
    quest(3, { shelvedAt: T2 });
    // 4. Active with no quest at all: back to ready, since it could never
    //    start work nor complete, and its frozen plan could not gain one.
    epic.run(4, 4, "empty", "active", T0, null);
    // 5. Done: completed, its date kept.
    epic.run(5, 5, "shipped", "done", T0, T1);
    // 6. Active whose only open quest is soft-deleted: that quest does not
    //    hold the epic open.
    epic.run(6, 6, "ghost", "active", T0, null);
    quest(6, { completedAt: T1 });
    quest(6, { deletedAt: T2 });

    apply(target!);

    const row = (id: number) =>
      db
        .prepare(
          "SELECT status, started_at AS startedAt, completed_at AS completedAt FROM epics WHERE id = ?",
        )
        .get(id);

    expect(row(1)).toEqual({
      status: "planned",
      startedAt: null,
      completedAt: null,
    });
    expect(row(2)).toEqual({
      status: "in_progress",
      startedAt: T0,
      completedAt: null,
    });
    expect(row(3)).toEqual({
      status: "completed",
      startedAt: T0,
      completedAt: T2,
    });
    expect(row(4)).toEqual({
      status: "ready",
      startedAt: null,
      completedAt: null,
    });
    expect(row(5)).toEqual({
      status: "completed",
      startedAt: T0,
      completedAt: T1,
    });
    expect(row(6)).toEqual({
      status: "completed",
      startedAt: T0,
      completedAt: T1,
    });

    // The property the whole migration exists for: nothing left that the
    // entity would refuse to decode.
    const retired = db
      .prepare(
        "SELECT COUNT(*) AS n FROM epics WHERE status NOT IN ('planned', 'ready', 'in_progress', 'completed')",
      )
      .get().n;
    expect(retired).toBe(0);

    db.close();
  });
});
