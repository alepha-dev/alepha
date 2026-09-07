import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Resolved from this file, not from `process.cwd()`: the root and the workspace
 * vitest configs run with different working directories, and a cwd-relative
 * path here is green under one runner and red under the other.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * Turning `apps.deploy` on for the projects that already lent an estate.
 *
 * ## Why this is executed rather than read
 *
 * `migration-safety.spec.ts` applies migrations only up to specific historical
 * points, so a backfill added afterwards is never run by anything in the suite
 * - it is verified by reading it. Two of the four ways this statement could be
 * silently wrong are invisible to a reader:
 *
 * - `json_set(options, '$.deploy', true)` writes integer `1`, which fails
 *   `z.boolean()` on read. That is the 2026-08-05 incident, where a row that
 *   could not decode made every query touching the table throw.
 * - `options = '{"deploy":true}'` turns somebody's `track` off, silently, and
 *   the only symptom is analytics quietly stopping.
 *
 * So this seeds the shapes that are hard and asserts what comes out.
 */
describe("the apps.deploy backfill", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  /**
   * The file with its `--` comments removed, so a guard reads what the
   * database executes rather than the prose explaining it. This migration's
   * own comments name `projects` and `DROP TABLE` while doing neither.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const backfill = migrations.find((name) =>
    statementsOf(name).includes("'$.deploy'"),
  );

  it("exists", ({ expect }) => {
    expect(backfill).toBeDefined();
  });

  it("touches project_capabilities and never projects", ({ expect }) => {
    // ⚠️ `projects` is the D1 cascade parent that wiped production in 2026-05.
    // No migration touches it when another table will do.
    const sql = statementsOf(backfill!);
    expect(sql).toMatch(/UPDATE\s+`?project_capabilities`?/i);
    expect(sql).not.toMatch(/UPDATE\s+`?projects`?\s/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });

  it("writes a JSON boolean and not an integer", ({ expect }) => {
    // `json_extract` on a JSON boolean returns integer 1, so a naive
    // round-trip writes `1` and the row stops decoding.
    expect(statementsOf(backfill!)).toContain("json('true')");
  });

  it("turns deploy on where an estate is lent, and nowhere else", ({
    expect,
  }) => {
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
    for (const dir of migrations.slice(0, migrations.indexOf(backfill!))) {
      apply(dir);
    }

    const owner = "00000000-0000-0000-0000-000000000001";
    db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(
      owner,
      "owner",
    );
    const project = db.prepare(
      "INSERT INTO projects (id, title, slug, created_by) VALUES (?, ?, ?, ?)",
    );
    // 1: lends an estate, has Apps with tracking on. The case the backfill is
    //    for, and the one that must not lose `track`.
    // 2: lends an estate, has no Apps capability at all. Untouched: the
    //    backfill flips an option inside a capability a project already has,
    //    and inserting one would turn a surface on that nobody asked for.
    // 3: has Apps and lends nothing. Untouched.
    project.run(1, "Lender", "lender", owner);
    project.run(2, "No apps", "no-apps", owner);
    project.run(3, "No estate", "no-estate", owner);

    const estateId = "00000000-0000-0000-0000-0000000000e1";
    db.prepare(
      "INSERT INTO estates (id, owner_user_id, slug, type) VALUES (?, ?, ?, ?)",
    ).run(estateId, owner, "an-account", "cloudflare");
    const lend = db.prepare(
      "INSERT INTO estate_projects (estate_id, project_id) VALUES (?, ?)",
    );
    lend.run(estateId, 1);
    lend.run(estateId, 2);

    const capability = db.prepare(
      "INSERT INTO project_capabilities (project_id, key, options) VALUES (?, ?, ?)",
    );
    capability.run(1, "apps", '{"track":true,"deploy":false}');
    capability.run(1, "work", "{}");
    capability.run(3, "apps", '{"track":false,"deploy":false}');

    apply(backfill!);

    const optionsOf = (projectId: number, key: string) => {
      const row = db
        .prepare(
          "SELECT options FROM project_capabilities WHERE project_id = ? AND key = ?",
        )
        .get(projectId, key);
      return row ? JSON.parse(row.options) : undefined;
    };

    // ⚠️ `true`, not `1`. An integer here is a row that fails `z.boolean()`
    // on read, which is what took production down on 2026-08-05.
    expect(optionsOf(1, "apps")).toEqual({ track: true, deploy: true });
    // The sibling option survived, which `options = '{"deploy":true}'` would
    // not have done.
    expect(optionsOf(1, "apps").track).toBe(true);
    // A capability that is not Apps is not touched at all.
    expect(optionsOf(1, "work")).toEqual({});
    // Lends an estate but has no Apps capability: still none.
    expect(optionsOf(2, "apps")).toBeUndefined();
    // Has Apps, lends nothing: unchanged.
    expect(optionsOf(3, "apps")).toEqual({ track: false, deploy: false });
  });

  it("is idempotent", ({ expect }) => {
    // Applied twice by a retry, or read again by anybody wondering, it says
    // the same thing.
    const sql = statementsOf(backfill!);
    expect(sql).not.toMatch(/INSERT/i);
    expect(sql).toMatch(/json_set/);
  });
});
