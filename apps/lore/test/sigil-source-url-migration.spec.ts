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
 * The one-off cleanup of `source_url` on rows written before errors were
 * scrubbed (quest #239, objective 8).
 *
 * Both ends scrub now - `sigilScrubUrl` at the source in
 * `SigilBrowserProvider` and `SigilServerErrors`, and again at the sink in
 * `SigilIngestService.fold` - so every row written since is clean. The rows
 * written before are not, and nothing reclaims them: a blight is readable by
 * every project member, and a resolved or `quest:`-forwarded one is kept
 * indefinitely as audit trail, outside the retention sweep.
 *
 * ⚠️ Applied for real against seeded rows, not read. `migration-safety.spec.ts`
 * applies migrations only up to specific historical points, so a data
 * statement added at the tip is otherwise verified by eye - and a `substr` /
 * `instr` pair is exactly the kind of statement that is green in review and
 * off by one against rows.
 */
describe("the stored sourceUrl cleanup migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  /**
   * The same file with `--` line comments removed, so the destructive-statement
   * guard reads what the database will execute rather than the prose around
   * it. This migration's own comments say it carries no `DROP TABLE`, and a
   * raw text match would fail on that sentence.
   */
  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  const found = migrations.find((name) =>
    name.endsWith("scrub_stored_source_urls"),
  );

  it("exists", ({ expect }) => {
    expect(found).toBeDefined();
  });

  it("drops no table, so the D1 cascade quirk cannot apply", ({ expect }) => {
    expect(statementsOf(found!)).not.toMatch(/DROP TABLE/i);
  });

  it("strips a query string and a fragment from rows already stored", ({
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

    for (const dir of migrations.slice(0, migrations.indexOf(found!))) {
      apply(dir);
    }

    // Both tables have NOT NULL columns beyond the one under test, so the
    // seed fills them with placeholders. `blights.project_id` has a foreign
    // key, and `foreign_keys = ON` above means a project row has to exist.
    db.prepare(
      "INSERT INTO projects (id, title, created_by) VALUES (1, 'p', ?)",
    ).run("00000000-0000-0000-0000-000000000001");
    // `sigil_error_groups.sigil_id` carries a real foreign key, so with
    // `foreign_keys = ON` the parent has to exist.
    db.prepare(
      "INSERT INTO sigils (id, project_id, name, token_hash, token_prefix) VALUES ('s', 1, 'app', 'h', 'sg_')",
    ).run();
    const at = "2026-01-01T00:00:00.000Z";

    const seedInto = (table: string) => {
      const insert =
        table === "blights"
          ? db.prepare(
              `INSERT INTO ${table} (id, project_id, fingerprint, name, message, source_url, first_seen_at, last_seen_at) VALUES (?, 1, ?, 'E', 'm', ?, '${at}', '${at}')`,
            )
          : db.prepare(
              `INSERT INTO ${table} (id, sigil_id, fingerprint, name, message, stack_sample, source_url, first_seen_at, last_seen_at) VALUES (?, 's', ?, 'E', 'm', '', ?, '${at}', '${at}')`,
            );
      const rows: Array<[number, string]> = [
        // The case the quest was filed for: a reset token in the query.
        [1, "https://club.alepha.dev/auth/reset-password?token=abc123"],
        // An OAuth implicit-flow access token lives in the fragment.
        [2, "https://club.alepha.dev/callback#access_token=xyz"],
        // Both, in the order a URL actually puts them.
        [3, "https://club.alepha.dev/a?b=1#c"],
        // Already clean: must come out byte-identical, since this migration
        // runs against databases that are mostly clean rows.
        [4, "https://club.alepha.dev/auth/login"],
        // The empty string is the column's own default.
        [5, ""],
      ];
      for (const [id, url] of rows) insert.run(id, `${table}-${id}`, url);
    };

    // `blights` and `sigil_error_groups` both carry the column and both are
    // written by the same fold, so a fix to one and not the other would be
    // invisible until somebody opened the wrong page.
    const tables = ["blights", "sigil_error_groups"];
    for (const table of tables) seedInto(table);

    apply(found!);

    for (const table of tables) {
      const urlOf = (id: number) =>
        db.prepare(`SELECT source_url FROM ${table} WHERE id = ?`).get(id)
          .source_url;

      expect(urlOf(1)).toBe("https://club.alepha.dev/auth/reset-password");
      expect(urlOf(2)).toBe("https://club.alepha.dev/callback");
      expect(urlOf(3)).toBe("https://club.alepha.dev/a");
      expect(urlOf(4)).toBe("https://club.alepha.dev/auth/login");
      expect(urlOf(5)).toBe("");
    }

    db.close();
  });
});
