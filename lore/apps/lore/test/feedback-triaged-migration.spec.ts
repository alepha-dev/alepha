import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

const MIGRATION = join(
  import.meta.dirname,
  "../migrations/sqlite/20261101113600_feedback_triaged/migration.sql",
);

/**
 * The backfill of `feedback.triagedAt` / `triagedBy` from audits (#Q3005).
 * Every database the suite builds is empty, so nothing else runs this SQL
 * against a row.
 */
describe("feedback triaged migration", () => {
  const setup = () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id text PRIMARY KEY);
      CREATE TABLE feedback (
        id integer PRIMARY KEY, project_id integer, short_id integer, status text
      );
      CREATE TABLE audits (
        id integer PRIMARY KEY, created_at integer, type text, action text,
        scope_type text, scope_id text, resource_id text, user_id text
      );
      INSERT INTO users VALUES ('owner');
      INSERT INTO feedback VALUES
        (1, 7, 1, 'accepted'),
        (2, 7, 2, 'rejected'),
        (3, 7, 3, 'pending'),
        (4, 7, 4, 'accepted'),
        (5, 8, 1, 'accepted');
      INSERT INTO audits VALUES
        (1, 100, 'feedback', 'accept', 'project', '7', '1', 'owner'),
        (2, 200, 'feedback', 'reject', 'project', '7', '2', 'gone'),
        (3, 300, 'feedback', 'create', 'project', '7', '3', 'owner'),
        (4, 400, 'quest', 'accept', 'project', '7', '4', 'owner');
    `);
    database.exec(
      readFileSync(MIGRATION, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
    return (id: number) =>
      database
        .prepare("SELECT triaged_at, triaged_by FROM feedback WHERE id = ?")
        .get(id);
  };

  it("takes the time and the actor from the accept audit", ({ expect }) => {
    expect(setup()(1)).toEqual({ triaged_at: 100, triaged_by: "owner" });
  });

  it("keeps the time of an actor whose account is gone", ({ expect }) => {
    expect(setup()(2)).toEqual({ triaged_at: 200, triaged_by: null });
  });

  it("leaves a pending report alone", ({ expect }) => {
    expect(setup()(3)).toEqual({ triaged_at: null, triaged_by: null });
  });

  it("leaves a row with no triage audit unknown, whatever else audited it", ({
    expect,
  }) => {
    expect(setup()(4)).toEqual({ triaged_at: null, triaged_by: null });
  });

  it("does not match the same shortId of another project", ({ expect }) => {
    expect(setup()(5)).toEqual({ triaged_at: null, triaged_by: null });
  });
});
