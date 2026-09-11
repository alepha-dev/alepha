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
 * The migration that renamed the stored copies of a quest status (#Q2269):
 * `new` to `todo` and `accepted` to `in_progress`, inside
 * `projects.kanban_column_config` and the Active quests card filters.
 *
 * Every database the suite builds is empty, so no other spec can see a row
 * still holding an old value. On the projects row that is not cosmetic: the
 * config is validated on READ, and a value the enum no longer knows fails
 * every project query (the 2026-08-05 shape). This spec seeds the old shapes
 * and applies the SQL for real.
 */
describe("quest status names migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  /**
   * What the database executes, without the `--` prose around it.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const target = migrations.find((name) =>
    statementsOf(name).includes(
      "UPDATE `projects`\nSET `kanban_column_config`",
    ),
  );

  it("exists", ({ expect }) => {
    expect(target).toBeDefined();
  });

  it("never drops a table", ({ expect }) => {
    // `projects` is the CASCADE parent that wiped production once.
    expect(statementsOf(target!)).not.toMatch(/DROP TABLE/i);
  });

  it("rewrites every stored quest status and nothing else", ({ expect }) => {
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

    const project = db.prepare(
      "INSERT INTO projects (id, title, created_by, kanban_column_config) VALUES (?, ?, ?, ?)",
    );
    // 1. Every shape a column config takes: a not-started lane, an
    //    in-progress one with a WIP limit, a done-ish one with a colour, and
    //    one that says nothing about its status.
    project.run(
      1,
      "Configured",
      owner,
      JSON.stringify({
        Backlog: { status: "new" },
        Doing: { status: "accepted", wipLimit: 3 },
        Done: { status: "completed", color: "green" },
        Plain: { wipLimit: 2 },
      }),
    );
    // 2. No config at all: stays NULL.
    project.run(2, "Plain", owner, null);
    // 3. A column NAMED like a status is a name, not a status.
    project.run(
      3,
      "Named",
      owner,
      JSON.stringify({ new: { wipLimit: 1 }, "In Progress": {} }),
    );

    const card = db.prepare(
      "INSERT INTO project_dashboard_cards (project_id, metric, scope, filters) VALUES (1, ?, 'project', ?)",
    );
    card.run("activeQuests", JSON.stringify({ statuses: ["new", "accepted"] }));
    card.run("activeQuests", JSON.stringify({ statuses: ["new"] }));
    card.run("activeQuests", JSON.stringify({}));
    // Another metric's filter is never read as a quest status.
    card.run("untriagedFeedback", JSON.stringify({ statuses: ["new"] }));

    db.prepare(
      "INSERT INTO dashboard_cards (user_id, metric, scope, filters) VALUES (?, 'activeQuests', 'all', ?)",
    ).run(owner, JSON.stringify({ statuses: ["accepted"], extra: 1 }));

    apply(target!);

    const configOf = (id: number) => {
      const raw = db
        .prepare(
          "SELECT kanban_column_config AS config FROM projects WHERE id = ?",
        )
        .get(id).config;
      return raw === null ? null : JSON.parse(raw);
    };

    expect(configOf(1)).toEqual({
      Backlog: { status: "todo" },
      Doing: { status: "in_progress", wipLimit: 3 },
      Done: { status: "completed", color: "green" },
      Plain: { wipLimit: 2 },
    });
    expect(configOf(2)).toBeNull();
    expect(configOf(3)).toEqual({ new: { wipLimit: 1 }, "In Progress": {} });

    const filters = db
      .prepare(
        "SELECT metric, filters FROM project_dashboard_cards ORDER BY id",
      )
      .all()
      .map((row: { metric: string; filters: string }) => [
        row.metric,
        JSON.parse(row.filters),
      ]);
    expect(filters).toEqual([
      ["activeQuests", { statuses: ["todo", "in_progress"] }],
      ["activeQuests", { statuses: ["todo"] }],
      ["activeQuests", {}],
      ["untriagedFeedback", { statuses: ["new"] }],
    ]);

    expect(
      JSON.parse(
        db.prepare("SELECT filters FROM dashboard_cards").get().filters,
      ),
    ).toEqual({ statuses: ["in_progress"], extra: 1 });

    db.close();
  });
});
