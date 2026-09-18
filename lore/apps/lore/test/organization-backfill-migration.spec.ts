import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "vitest";

const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

describe("organization backfill migration", () => {
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

  const backfill = migrations.find((name) =>
    sqlOf(name).includes("E61 organization backfill"),
  );

  it("is additive and every write carries an idempotency guard", ({
    expect,
  }) => {
    expect(backfill).toBeDefined();
    const sql = statementsOf(backfill!);
    expect(sql).not.toMatch(/\b(?:DROP|ALTER|CREATE)\b/i);
    expect(sql).not.toMatch(/__new_/i);

    const statements = sqlOf(backfill!)
      .split("--> statement-breakpoint")
      .map((statement) =>
        statement
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter(Boolean);
    expect(statements).toHaveLength(7);
    for (const statement of statements) {
      expect(statement).toMatch(/\bWHERE\b/i);
      expect(statement).toMatch(/(?:IS NULL|NOT EXISTS|\bIN\s*\()/i);
    }
  });

  it("copies live authority data once and preserves the legacy rows", ({
    expect,
  }) => {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
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

    const creator = "00000000-0000-4000-8000-000000000001";
    const member = "00000000-0000-4000-8000-000000000002";
    const transferredCreator = "00000000-0000-4000-8000-000000000003";
    const transferredOwner = "00000000-0000-4000-8000-000000000004";
    const repairedCreator = "00000000-0000-4000-8000-000000000005";

    const insertUser = db.prepare(
      "INSERT INTO users (id, email) VALUES (?, ?)",
    );
    for (const [id, email] of [
      [creator, "creator@example.com"],
      [member, "member@example.com"],
      [transferredCreator, "former@example.com"],
      [transferredOwner, "owner@example.com"],
      [repairedCreator, "repaired@example.com"],
    ]) {
      insertUser.run(id, email);
    }

    const insertProject = db.prepare(
      "INSERT INTO projects (id, title, slug, created_by, deleted_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertProject.run(1, "Ordinary", "ordinary", creator, null);
    insertProject.run(2, "Deleted", null, creator, 1_757_000_000_000);
    insertProject.run(
      3,
      "Transferred",
      "transferred",
      transferredCreator,
      null,
    );
    insertProject.run(4, "Repair", "repair", repairedCreator, null);

    const insertMember = db.prepare(
      "INSERT INTO members (id, user_id, project_id, rank) VALUES (?, ?, ?, ?)",
    );
    insertMember.run(1, creator, 1, "owner");
    insertMember.run(2, member, 1, null);
    insertMember.run(3, creator, 2, "owner");
    insertMember.run(4, transferredOwner, 3, "owner");
    insertMember.run(5, repairedCreator, 4, null);

    const insertRank = db.prepare(
      "INSERT INTO rank_definitions (id, type, scope_id, key, name, builtin, permissions) VALUES (?, 'project', ?, ?, ?, ?, ?)",
    );
    const liveRank = "00000000-0000-4000-8000-000000000101";
    const deletedRank = "00000000-0000-4000-8000-000000000102";
    insertRank.run(liveRank, "1", "reviewer", "Reviewer", 0, '["quest:read"]');
    insertRank.run(deletedRank, "2", "historical", "Historical", 0, "[]");

    const insertInvitation = db.prepare(
      "INSERT INTO invitations (id, invited_by, email, resource_type, resource_id, status, roles, expires_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const pending = "00000000-0000-4000-8000-000000000201";
    const resolved = "00000000-0000-4000-8000-000000000202";
    const deletedPending = "00000000-0000-4000-8000-000000000203";
    insertInvitation.run(
      pending,
      creator,
      "pending@example.com",
      "project",
      "1",
      "pending",
      '["reviewer"]',
      1_900_000_000_000,
      null,
    );
    insertInvitation.run(
      resolved,
      creator,
      "resolved@example.com",
      "project",
      "1",
      "accepted",
      '["reviewer"]',
      1_900_000_000_000,
      1_800_000_000_000,
    );
    insertInvitation.run(
      deletedPending,
      creator,
      "deleted@example.com",
      "project",
      "2",
      "pending",
      '["reviewer"]',
      1_900_000_000_000,
      null,
    );

    const legacyCounts = {
      members: db.prepare("SELECT COUNT(*) AS n FROM members").get().n,
      ranks: db.prepare("SELECT COUNT(*) AS n FROM rank_definitions").get().n,
      invitations: db.prepare("SELECT COUNT(*) AS n FROM invitations").get().n,
    };

    apply(backfill!);

    const organizationId = (projectId: number) =>
      `00000000-0000-4000-8000-${String(projectId).padStart(12, "0")}`;
    const projectRows = db
      .prepare("SELECT id, organization_id FROM projects ORDER BY id")
      .all();
    expect(projectRows).toEqual(
      [1, 2, 3, 4].map((id) => ({
        id,
        organization_id: organizationId(id),
      })),
    );
    expect(
      db.prepare("SELECT id, name FROM organizations ORDER BY id").all(),
    ).toEqual([
      { id: organizationId(1), name: "Ordinary" },
      { id: organizationId(2), name: "Deleted" },
      { id: organizationId(3), name: "Transferred" },
      { id: organizationId(4), name: "Repair" },
    ]);

    const memberRows = db
      .prepare(
        "SELECT organization_id, user_id, rank FROM organization_members ORDER BY organization_id, user_id",
      )
      .all();
    expect(memberRows).toEqual([
      { organization_id: organizationId(1), user_id: creator, rank: "owner" },
      { organization_id: organizationId(1), user_id: member, rank: null },
      {
        organization_id: organizationId(3),
        user_id: transferredOwner,
        rank: "owner",
      },
      {
        organization_id: organizationId(4),
        user_id: repairedCreator,
        rank: "owner",
      },
    ]);
    expect(
      memberRows.some((row: any) => row.user_id === transferredCreator),
    ).toBe(false);

    const ownerOffenders = db
      .prepare(
        `SELECT p.id, COUNT(om.id) AS owners
           FROM projects p
           LEFT JOIN organization_members om
             ON om.organization_id = p.organization_id AND om.rank = 'owner'
          WHERE p.deleted_at IS NULL
          GROUP BY p.id
         HAVING owners <> 1`,
      )
      .all();
    expect(ownerOffenders).toEqual([]);

    expect(db.prepare("SELECT * FROM organization_ranks").all()).toMatchObject([
      {
        id: liveRank,
        organization_id: organizationId(1),
        key: "reviewer",
        name: "Reviewer",
        permissions: '["quest:read"]',
      },
    ]);
    expect(
      db
        .prepare(
          "SELECT id, organization_id, status, rank FROM organization_invitations",
        )
        .all(),
    ).toEqual([
      {
        id: pending,
        organization_id: organizationId(1),
        status: "pending",
        rank: "reviewer",
      },
    ]);

    expect({
      members: db.prepare("SELECT COUNT(*) AS n FROM members").get().n,
      ranks: db.prepare("SELECT COUNT(*) AS n FROM rank_definitions").get().n,
      invitations: db.prepare("SELECT COUNT(*) AS n FROM invitations").get().n,
    }).toEqual(legacyCounts);

    const copiedBeforeSecondRun = {
      organizations: db
        .prepare("SELECT * FROM organizations ORDER BY id")
        .all(),
      members: db
        .prepare("SELECT * FROM organization_members ORDER BY id")
        .all(),
      ranks: db.prepare("SELECT * FROM organization_ranks ORDER BY id").all(),
      invitations: db
        .prepare("SELECT * FROM organization_invitations ORDER BY id")
        .all(),
    };
    apply(backfill!);
    expect({
      organizations: db
        .prepare("SELECT * FROM organizations ORDER BY id")
        .all(),
      members: db
        .prepare("SELECT * FROM organization_members ORDER BY id")
        .all(),
      ranks: db.prepare("SELECT * FROM organization_ranks ORDER BY id").all(),
      invitations: db
        .prepare("SELECT * FROM organization_invitations ORDER BY id")
        .all(),
    }).toEqual(copiedBeforeSecondRun);

    db.close();
  });
});
