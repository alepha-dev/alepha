import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/** Resolved from this file, for the reason `sigil-source-url-migration.spec.ts` gives. */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The migration that gives a project several dashboards (#E127, #Q3298).
 *
 * ⚠️ Applied for real against seeded rows: a card the backfill misses, or one
 * it lands on another project's dashboard, is a board somebody curated gone
 * from the page.
 */
describe("the project dashboards migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const found = migrations.find((name) => name.endsWith("_project_dashboards"));

  it("adds the card's dashboard as a column, never by a rebuild", ({
    expect,
  }) => {
    expect(found).toBeDefined();
    const sql = statementsOf(found!);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/__new_project_dashboard_cards/);
    expect(sql).toMatch(
      /ALTER TABLE `project_dashboard_cards` ADD `dashboard_id` integer REFERENCES project_dashboards\(id\) ON DELETE CASCADE/,
    );
  });

  it("lands every existing card on its own project's first dashboard", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };
    for (const dir of migrations.slice(0, migrations.indexOf(found!))) {
      apply(dir);
    }

    // Seeded without parents: the statements under test read no project.
    db.exec("PRAGMA foreign_keys = OFF");
    const card = db.prepare(
      'INSERT INTO project_dashboard_cards (project_id, metric, scope, position) VALUES (?, \'activeQuests\', \'{"kind":"projects","projectIds":[1]}\', ?)',
    );
    // Two projects with stored cards, and project 3 on its computed board.
    card.run(1, 0);
    card.run(1, 1);
    card.run(1, 2);
    card.run(2, 0);
    card.run(2, 1);

    apply(found!);

    const dashboards = db
      .prepare(
        "SELECT id, project_id, name, slug, position, created_at FROM project_dashboards ORDER BY project_id",
      )
      .all();
    expect(dashboards).toHaveLength(2);
    expect(dashboards.map((it: any) => it.project_id)).toEqual([1, 2]);
    for (const row of dashboards) {
      expect(row.name).toBeNull();
      expect(row.slug).toBeNull();
      expect(row.position).toBe(0);
      // Epoch milliseconds, as the ORM writes it.
      expect(row.created_at).toBeGreaterThan(1_700_000_000_000);
    }

    const cards = db
      .prepare(
        "SELECT c.project_id AS card_project, d.project_id AS dashboard_project FROM project_dashboard_cards c LEFT JOIN project_dashboards d ON d.id = c.dashboard_id",
      )
      .all();
    expect(cards).toHaveLength(5);
    for (const row of cards) {
      expect(row.dashboard_project).toBe(row.card_project);
    }
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM project_dashboards WHERE project_id = 3",
        )
        .get().n,
    ).toBe(0);
  });
});
