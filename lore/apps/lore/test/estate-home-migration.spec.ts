import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/** Resolved from this file, for the reason `sigil-source-url-migration.spec.ts` gives. */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The two migrations that give every estate a home project (#Q3278, epic
 * #E126): the schema in place, then a data-only backfill.
 *
 * ⚠️ Applied for real against seeded rows, foreign keys on. `estates` has
 * nine child tables, and a rebuild would delete six of them and null the
 * other three, so this proves each one survives, and that the backfill homes
 * an estate only where its owner keeps managing it.
 */
describe("the estate home migrations", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  const statementsOf = (name: string) =>
    sqlOf(name)
      .split("--> statement-breakpoint")
      .map((statement) =>
        statement
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter(Boolean);

  const schema = migrations.find((name) =>
    name.endsWith("estate_home_project"),
  );
  const backfill = migrations.find((name) =>
    name.endsWith("estate_home_backfill"),
  );

  it("changes the schema in place, with no table rebuild", ({ expect }) => {
    expect(schema).toBeDefined();
    const sql = sqlOf(schema!);
    expect(sql).not.toMatch(/__new_/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(statementsOf(schema!)).toEqual([
      "ALTER TABLE `estates` ADD `project_id` integer REFERENCES projects(id) ON DELETE RESTRICT;",
      "ALTER TABLE `estates` ADD `created_by` text REFERENCES users(id) ON DELETE SET NULL;",
      "DROP INDEX IF EXISTS `estates_owner_user_id_slug_idx`;",
      "CREATE UNIQUE INDEX `estates_project_id_slug_idx` ON `estates` (`project_id`,`slug`);",
    ]);
  });

  it("backfills data only, and every statement carries its guard", ({
    expect,
  }) => {
    expect(backfill).toBeDefined();
    expect(migrations.indexOf(backfill!)).toBe(migrations.indexOf(schema!) + 1);
    const statements = statementsOf(backfill!);
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement).not.toMatch(/\b(?:DROP|ALTER|CREATE|INSERT|DELETE)\b/i);
      expect(statement).toMatch(/^UPDATE `estates`/);
      expect(statement).toMatch(/WHERE `(?:project_id|created_by)` IS NULL;$/);
    }
  });

  it("homes each estate by the three rules and keeps every child row", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };
    for (const dir of migrations.slice(0, migrations.indexOf(schema!))) {
      apply(dir);
    }

    const ann = "00000000-0000-4000-8000-0000000000a1";
    const bob = "00000000-0000-4000-8000-0000000000b1";
    const cat = "00000000-0000-4000-8000-0000000000c1";
    for (const id of [ann, bob, cat]) {
      db.prepare("INSERT INTO users (id) VALUES (?)").run(id);
    }

    // Projects, oldest first. Each is its own organization, as E61 left them.
    let member = 0;
    const project = (
      id: number,
      owner: string,
      options: { apps?: boolean; deleted?: boolean } = {},
    ) => {
      const org = `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
      db.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)").run(
        org,
        `p${id}`,
      );
      db.prepare(
        "INSERT INTO projects (id, title, created_by, organization_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        `p${id}`,
        owner,
        org,
        `2026-01-${String(id).padStart(2, "0")}T00:00:00.000Z`,
        options.deleted ? "2026-06-01T00:00:00.000Z" : null,
      );
      db.prepare(
        "INSERT INTO organization_members (id, organization_id, user_id, rank) VALUES (?, ?, ?, 'owner')",
      ).run(
        `10000000-0000-4000-8000-${String(++member).padStart(12, "0")}`,
        org,
        owner,
      );
      if (options.apps !== false) {
        db.prepare(
          "INSERT INTO project_capabilities (project_id, key) VALUES (?, 'apps')",
        ).run(id);
      }
      return org;
    };

    project(1, bob); // somebody else's, older than all of Ann's
    project(2, ann, { apps: false }); // Ann's, Apps off
    project(3, ann); // Ann's oldest qualifying project
    project(4, ann); // Ann's younger project
    project(5, ann, { deleted: true }); // Ann's, soft-deleted
    const transferred = project(6, ann); // created by Ann, now Cat's
    db.prepare(
      "UPDATE organization_members SET user_id = ? WHERE organization_id = ?",
    ).run(cat, transferred);
    project(7, cat, { apps: false }); // Cat's only other project, Apps off

    let n = 0;
    const estate = (slug: string, owner: string, loans: number[]) => {
      const id = `20000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      db.prepare(
        "INSERT INTO estates (id, owner_user_id, type, slug) VALUES (?, ?, 'bay', ?)",
      ).run(id, owner, slug);
      loans.forEach((projectId, index) => {
        db.prepare(
          "INSERT INTO estate_projects (estate_id, project_id, created_at) VALUES (?, ?, ?)",
        ).run(id, projectId, `2026-03-0${index + 1}T00:00:00.000Z`);
      });
      db.prepare(
        "INSERT INTO estate_commands (id, estate_id, kind, payload, timeout_seconds) VALUES (?, ?, 'restart', '{}', 60)",
      ).run(`cmd-${n}`, id);
      db.prepare(
        "INSERT INTO estate_events (estate_id, event_id, kind, at) VALUES (?, ?, 'deploy', '2026-03-01T00:00:00.000Z')",
      ).run(id, `evt-${n}`);
      db.prepare(
        "INSERT INTO estate_inventories (estate_id, at, reported_at, host, apps, app_count) VALUES (?, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '{}', '[]', 0)",
      ).run(id);
      for (const table of [
        "analytics_estate_stats_raw",
        "analytics_estate_stats_rolled",
      ]) {
        db.prepare(
          `INSERT INTO ${table} (time_bucket, estate_id, cpu, memory, samples) VALUES (1, ?, 1, 1, 1)`,
        ).run(id);
      }
      const copyProject = loans[0] ?? 3;
      db.prepare(
        "INSERT INTO app_instances (id, project_id, app, env, estate_id) VALUES (?, ?, ?, 'production', ?)",
      ).run(`copy-${n}`, copyProject, `app-${n}`, id);
      db.prepare(
        "INSERT INTO stacks (id, project_id, name, estate_id) VALUES (?, ?, ?, ?)",
      ).run(`stack-${n}`, copyProject, `stack-${n}`, id);
      db.prepare(
        "INSERT INTO stack_environments (id, stack_id, env, estate_id) VALUES (?, ?, 'production', ?)",
      ).run(`senv-${n}`, `stack-${n}`, id);
      return id;
    };

    const lentToOwn = estate("lent-to-own", ann, [4]); // rule 1
    const skipsOther = estate("skips-other", ann, [1, 4]); // rule 1, older loan skipped
    const notLent = estate("not-lent", ann, []); // rule 2
    const lentToAppsOff = estate("lent-apps-off", ann, [2]); // rule 2
    const lentToDeleted = estate("lent-deleted", ann, [5]); // rule 2
    // Lent to the project Ann created and gave to Cat: not Ann's any more.
    const lentToTransferred = estate("lent-transferred", ann, [6]); // rule 2
    const onlyOther = estate("only-other", ann, [1]); // rule 2
    // Bob's, lent to a project Bob does not own: rule 2, Bob's own project.
    const memberOnly = estate("member-only", bob, [6]);
    // Cat's, lent to Cat's project with Apps off: rule 2, the transferred one.
    const catAppsOff = estate("cat-apps-off", cat, [7]);
    // Cat's, lent to Bob's: rule 2, the project transferred to Cat.
    const catLentAway = estate("cat-lent-away", cat, [1]);

    // Rule 3: a member who owns no project, lent only to somebody else's.
    const dan = "00000000-0000-4000-8000-0000000000d1";
    db.prepare("INSERT INTO users (id) VALUES (?)").run(dan);
    const homeless = estate("homeless", dan, [3]);

    const counts = () =>
      Object.fromEntries(
        [
          "estate_projects",
          "estate_commands",
          "estate_events",
          "estate_inventories",
          "analytics_estate_stats_raw",
          "analytics_estate_stats_rolled",
        ]
          .map((table) => [
            table,
            db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
          ])
          .concat(
            ["app_instances", "stacks", "stack_environments"].map((table) => [
              table,
              db
                .prepare(
                  `SELECT COUNT(*) AS n FROM ${table} WHERE estate_id IS NOT NULL`,
                )
                .get().n,
            ]),
          ),
      );
    const before = counts();
    const estatesBefore = db
      .prepare("SELECT id, slug, owner_user_id FROM estates ORDER BY id")
      .all();

    apply(schema!);
    apply(backfill!);

    const homeOf = (id: string) =>
      db.prepare("SELECT project_id FROM estates WHERE id = ?").get(id)
        .project_id;
    expect(homeOf(lentToOwn)).toBe(4);
    expect(homeOf(skipsOther)).toBe(4);
    expect(homeOf(notLent)).toBe(3);
    expect(homeOf(lentToAppsOff)).toBe(3);
    expect(homeOf(lentToDeleted)).toBe(3);
    expect(homeOf(lentToTransferred)).toBe(3);
    expect(homeOf(onlyOther)).toBe(3);
    expect(homeOf(memberOnly)).toBe(1);
    expect(homeOf(catAppsOff)).toBe(6);
    expect(homeOf(catLentAway)).toBe(6);
    expect(homeOf(homeless)).toBeNull();

    // Nothing else moved: the anchor, the slug, every child row.
    expect(
      db
        .prepare("SELECT id, slug, owner_user_id FROM estates ORDER BY id")
        .all(),
    ).toEqual(estatesBefore);
    expect(counts()).toEqual(before);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM estates WHERE created_by IS NOT owner_user_id",
        )
        .get().n,
    ).toBe(0);

    // A homed estate's anchor is its home project's owner.
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM estates e
           JOIN projects p ON p.id = e.project_id
           WHERE NOT EXISTS (
             SELECT 1 FROM organization_members om
             WHERE om.organization_id = p.organization_id
               AND om.user_id = e.owner_user_id AND om.rank = 'owner')`,
        )
        .get().n,
    ).toBe(0);

    // Applied again, it changes nothing.
    const after = db.prepare("SELECT * FROM estates ORDER BY id").all();
    apply(backfill!);
    expect(db.prepare("SELECT * FROM estates ORDER BY id").all()).toEqual(
      after,
    );
  });
});
