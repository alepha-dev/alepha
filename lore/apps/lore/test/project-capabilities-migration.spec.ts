import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Resolved from this file, not from `process.cwd()`: the root
 * `vitest.config.ts` and `apps/lore/vitest.config.ts` run with different
 * working directories, and a cwd-relative path here is green under one runner
 * and red under the other.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The backfill that turns `projects.features` into `project_capabilities`
 * rows, applied for real against seeded pre-migration projects.
 *
 * The bar for the whole capabilities epic is **no existing project changes
 * behaviour**, and every way of breaking it is invisible by inspection:
 *
 * - an optional key is absent from every row that predates it, so a test
 *   phrased as a negation turns it on for the entire table;
 * - `json_object('board', json_extract(...))` stores SQLite's integer 1, and
 *   the entity decodes `options` as booleans, so the row loads nowhere;
 * - `apps` from `sigils` alone drops the Quality tab of a project that had
 *   `quality` on and never used a sigil.
 *
 * None of those is reachable by running the app: `yarn v`, CI and the test
 * suite all construct an empty database, and the statements only ever meet a
 * populated one in production. So this seeds the rows the migration will
 * actually meet and reads back what it wrote.
 */
describe("project capabilities backfill migration", () => {
  // `.archive/` holds migrations retired by `db create --baseline` and carries
  // no `migration.sql` of its own, so directories are filtered on the file
  // actually being there rather than on the name.
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  /**
   * The same file with `--` line comments removed. The destructive-statement
   * guard has to read what the database will execute rather than the prose
   * around it: this migration's own comments explain why it rebuilds nothing,
   * and a raw text match fails on the explanation.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const found = migrations.find((name) =>
    sqlOf(name).includes("CREATE TABLE `project_capabilities`"),
  );

  it("exists", ({ expect }) => {
    expect(found).toBeDefined();
  });

  it("drops no table, so the D1 cascade quirk cannot apply", ({ expect }) => {
    expect(statementsOf(found!)).not.toMatch(/DROP TABLE/i);
  });

  it("touches no column of the cascade parent", ({ expect }) => {
    // An `ALTER TABLE projects` here would be the one thing this table exists
    // to avoid.
    expect(statementsOf(found!)).not.toMatch(/ALTER TABLE\s+`?projects`?/i);
  });

  it("backfills every project from its feature bag", ({ expect }) => {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");

    // D1 ignores `PRAGMA foreign_keys=OFF`, so constraints are always live
    // there. Enforcing them here reproduces D1 rather than the friendlier
    // local SQLite the rest of the suite runs on.
    db.pragma("foreign_keys = ON");

    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };

    for (const dir of migrations.slice(0, migrations.indexOf(found!))) {
      apply(dir);
    }

    const owner = "00000000-0000-0000-0000-000000000001";
    const seed = db.prepare(
      "INSERT INTO projects (id, title, created_by, created_at, features, deleted_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    // Each row is a shape that exists in production today.
    const rows: Array<[number, string, object, number | null]> = [
      // 1. The oldest shape: the four required keys and nothing else. Every
      //    optional switch is ABSENT, not false, which is the case a
      //    negated test gets wrong.
      [
        1,
        "legacy",
        { kanban: true, folios: true, feedback: true, milestones: true },
        null,
      ],
      // 2. Everything a project can turn on.
      [
        2,
        "maximal",
        {
          kanban: true,
          folios: true,
          feedback: true,
          milestones: true,
          epics: true,
          sigils: true,
          quality: true,
          folioSummary: true,
          questEstimate: true,
          questChrono: true,
          questReminder: true,
        },
        null,
      ],
      // 3. Everything a project can turn off. `work` must still arrive.
      [
        3,
        "minimal",
        { kanban: false, folios: false, feedback: false, milestones: false },
        null,
      ],
      // 4. Quality on, no sigil. The OR in the `apps` WHERE is the only
      //    thing that keeps this project's Quality tab.
      [
        4,
        "quality-only",
        {
          kanban: true,
          folios: true,
          feedback: true,
          milestones: true,
          quality: true,
        },
        null,
      ],
      // 5. Soft-deleted. A restored project keeps its behaviour, so it is
      //    backfilled like any other.
      [
        5,
        "deleted",
        { kanban: true, folios: true, feedback: true, milestones: true },
        1_700_000_000_000,
      ],
    ];

    for (const [id, title, features, deletedAt] of rows) {
      seed.run(
        id,
        title,
        owner,
        1_600_000_000_000 + id,
        JSON.stringify(features),
        deletedAt,
      );
    }

    apply(found!);

    const keysOf = (projectId: number): string[] =>
      db
        .prepare(
          "SELECT key FROM project_capabilities WHERE project_id = ? ORDER BY key",
        )
        .all(projectId)
        .map((row: { key: string }) => row.key);

    const optionsOf = (projectId: number, key: string): unknown =>
      JSON.parse(
        db
          .prepare(
            "SELECT options FROM project_capabilities WHERE project_id = ? AND key = ?",
          )
          .get(projectId, key).options,
      );

    // 1. Legacy: the three flagged capabilities plus work, no apps.
    expect(keysOf(1)).toStrictEqual(["knowledge", "support", "work"]);
    expect(optionsOf(1, "work")).toStrictEqual({
      board: true,
      epics: false,
      releases: true,
      estimate: false,
      chrono: false,
      reminder: false,
    });
    expect(optionsOf(1, "knowledge")).toStrictEqual({ agentSummary: false });
    expect(optionsOf(1, "support")).toStrictEqual({});

    // 2. Maximal.
    expect(keysOf(2)).toStrictEqual(["apps", "knowledge", "support", "work"]);
    expect(optionsOf(2, "work")).toStrictEqual({
      board: true,
      epics: true,
      releases: true,
      estimate: true,
      chrono: true,
      reminder: true,
    });
    expect(optionsOf(2, "knowledge")).toStrictEqual({ agentSummary: true });
    expect(optionsOf(2, "apps")).toStrictEqual({ track: true, deploy: false });

    // 3. Minimal: work alone, and every option off.
    expect(keysOf(3)).toStrictEqual(["work"]);
    expect(optionsOf(3, "work")).toStrictEqual({
      board: false,
      epics: false,
      releases: false,
      estimate: false,
      chrono: false,
      reminder: false,
    });

    // 4. Quality with no sigil: Apps baseline, tracking off.
    expect(keysOf(4)).toContain("apps");
    expect(optionsOf(4, "apps")).toStrictEqual({ track: false, deploy: false });

    // 5. Soft-deleted projects are backfilled too.
    expect(keysOf(5)).toStrictEqual(["knowledge", "support", "work"]);

    // `enabled_at` is the project's own creation, not the migration's clock.
    const enabledAt = db
      .prepare(
        "SELECT enabled_at FROM project_capabilities WHERE project_id = 2 AND key = 'work'",
      )
      .get().enabled_at;
    expect(enabledAt).toBe(1_600_000_000_002);

    // The stored options are JSON booleans, never SQLite's integer 1 — the
    // entity decodes them as booleans and an integer stops the row loading.
    const raw = db
      .prepare(
        "SELECT options FROM project_capabilities WHERE project_id = 2 AND key = 'apps'",
      )
      .get().options;
    expect(raw).toBe('{"track":true,"deploy":false}');

    db.close();
  });
});
