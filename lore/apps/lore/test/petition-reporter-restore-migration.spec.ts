import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the petition reporter-user-id restore migration.
 *
 * This migration reverses `0039_petition_reporter_email.sql` WITHOUT a table
 * rebuild: it adds a nullable `reporter_user_id` (with the cascade FK via the
 * `ADD COLUMN ... REFERENCES` form), back-fills it from `reporter_email`, drops
 * the email index + column, and recreates the reporter index.
 *
 * Because there is NO `DROP TABLE petitions`, there is no D1 cascade hazard
 * (the rebuild that would have nulled `quests.petition_id` is avoided entirely),
 * so no backup/restore of quest links and no orphan deletion are needed —
 * orphans simply keep `reporter_user_id = NULL`.
 *
 * Structural assertions only (no SQL-execution harness in the lore suite).
 * See CLAUDE.md "Migration safety on D1".
 */

const migrationPath = fileURLToPath(
  new URL(
    "../migrations/sqlite/0041_petition_reporter_user_id_restore.sql",
    import.meta.url,
  ),
);

describe("petition reporter user id restore migration safety", () => {
  const sql = readFileSync(migrationPath, "utf-8");

  it("adds reporter_user_id as a nullable column with the cascade FK", () => {
    expect(sql).toMatch(
      /ALTER TABLE\s+`petitions`\s+ADD COLUMN\s+`reporter_user_id`\s+text\s+REFERENCES\s+`users`\(`id`\)\s+ON DELETE cascade/i,
    );
  });

  it("does NOT declare reporter_user_id NOT NULL (SQLite ADD COLUMN can't)", () => {
    expect(sql).not.toMatch(/`reporter_user_id`[^\n]*NOT NULL/i);
  });

  it("back-fills reporter_user_id from the users.email subquery", () => {
    expect(sql).toMatch(
      /UPDATE\s+`petitions`[\s\S]*SET\s+`reporter_user_id`\s*=\s*\(SELECT\s+`id`\s+FROM\s+`users`\s+WHERE\s+`users`\.`email`\s*=\s*`petitions`\.`reporter_email`\)/i,
    );
  });

  it("drops the reporter_email index before dropping the column", () => {
    const dropIndexAt = sql.search(
      /DROP INDEX\s+`petitions_reporter_email_created_at_idx`/i,
    );
    const dropColAt = sql.search(
      /ALTER TABLE\s+`petitions`\s+DROP COLUMN\s+`reporter_email`/i,
    );
    expect(dropIndexAt).toBeGreaterThanOrEqual(0);
    expect(dropColAt).toBeGreaterThan(dropIndexAt);
  });

  it("drops the reporter_email column", () => {
    expect(sql).toMatch(
      /ALTER TABLE\s+`petitions`\s+DROP COLUMN\s+`reporter_email`/i,
    );
  });

  it("recreates the reporter_user_id index (not the old reporter_email one)", () => {
    expect(sql).toMatch(
      /CREATE INDEX\s+`petitions_reporter_user_id_created_at_idx`/i,
    );
  });

  it("performs NO table rebuild — no DROP TABLE anywhere", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/__new_petitions/i);
    expect(sql).not.toMatch(/__bk_quest_petition/i);
  });
});
