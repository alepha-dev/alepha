import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the petition reporter migration against D1 cascade-data-loss.
 *
 * Cloudflare D1 ignores `PRAGMA foreign_keys=OFF`. Rebuilding `petitions`
 * (required to drop reporter_user_id) fires `quests.petition_id ON DELETE
 * SET NULL` on D1, silently NULLing every petition→quest link in production.
 *
 * This migration back-fills the links via `__bk_quest_petition` before the
 * DROP and restores them after RENAME. This test asserts all required
 * structural invariants on the SQL file.
 *
 * NOTE: `0039_petition_reporter_email.sql` has been reversed by
 * `0041_petition_reporter_user_id_restore.sql`. This file continues to guard
 * 0039's structural invariants as a historical record. See
 * `petition-reporter-restore-migration.spec.ts` for the 0041 guard.
 *
 * NOTE: No migration-execution helper exists in the lore test suite that can
 * run raw SQL against an in-memory DB (existing tests use the full Alepha DI
 * stack that applies all migrations on start). These are therefore structural
 * assertions only — the logical correctness of the SQL must be verified by
 * the human reviewer before merging.
 *
 * See CLAUDE.md "Migration safety on D1".
 */

const migrationPath = fileURLToPath(
  new URL(
    "../migrations/sqlite/0039_petition_reporter_email.sql",
    import.meta.url,
  ),
);

describe("petition reporter migration safety", () => {
  const sql = readFileSync(migrationPath, "utf-8");

  it("backs up quest→petition links before the rebuild", () => {
    expect(sql).toMatch(/CREATE TABLE\s+`__bk_quest_petition`\s+AS\s+SELECT/is);
  });

  it("creates the __new_petitions scratch table", () => {
    expect(sql).toMatch(/CREATE TABLE\s+`__new_petitions`/i);
  });

  it("contains exactly one DROP TABLE `petitions`", () => {
    const drops = [...sql.matchAll(/^\s*DROP TABLE\s+`petitions`/gim)];
    expect(drops).toHaveLength(1);
  });

  it("back-fills reporter_email from users via subquery", () => {
    expect(sql).toMatch(
      /SELECT\s+`email`\s+FROM\s+`users`\s+WHERE\s+`users`\.`id`\s*=\s*`petitions`\.`reporter_user_id`/i,
    );
  });

  it("renames __new_petitions to petitions", () => {
    expect(sql).toMatch(
      /ALTER TABLE\s+`__new_petitions`\s+RENAME TO\s+`petitions`/i,
    );
  });

  it("restores quest→petition links after the rebuild", () => {
    expect(sql).toMatch(/UPDATE\s+`quests`/i);
    expect(sql).toMatch(/SET\s+`petition_id`\s*=/i);
    expect(sql).toMatch(/FROM\s+`__bk_quest_petition`/i);
  });

  it("drops the backup table as final cleanup", () => {
    expect(sql).toMatch(/DROP TABLE\s+`__bk_quest_petition`/i);
  });

  it("does NOT contain reporter_user_id in the new table DDL column list", () => {
    // Extract the block between CREATE TABLE `__new_petitions` and the first
    // occurrence of `INSERT INTO` (which follows it). This avoids the nested-
    // paren problem with a simple start/end anchor approach.
    const ddlBlock = sql.match(
      /CREATE TABLE `__new_petitions`([\s\S]+?)INSERT INTO `__new_petitions`/i,
    )?.[1];
    expect(ddlBlock).toBeDefined();
    // reporter_user_id must NOT appear as a column definition in the DDL
    // (it may appear in the back-fill SELECT below, but not in CREATE TABLE).
    expect(ddlBlock).not.toMatch(/`reporter_user_id`/i);
  });

  it("contains reporter_email in the new table DDL column list", () => {
    const ddlBlock = sql.match(
      /CREATE TABLE `__new_petitions`([\s\S]+?)INSERT INTO `__new_petitions`/i,
    )?.[1];
    expect(ddlBlock).toBeDefined();
    expect(ddlBlock).toMatch(/`reporter_email`/i);
  });

  it("recreates the reporter_email+created_at index (not the old reporter_user_id one)", () => {
    expect(sql).toMatch(/petitions_reporter_email_created_at_idx/i);
    expect(sql).not.toMatch(/petitions_reporter_user_id_created_at_idx/i);
  });

  it("contains no DROP TABLE for any table other than petitions and scratch tables", () => {
    const dropLines = [...sql.matchAll(/^\s*DROP TABLE\s+`?(\w+)`?/gim)].map(
      (m) => m[1],
    );
    const allowed = new Set([
      "__bk_quest_petition",
      "__new_petitions",
      "petitions",
    ]);
    for (const table of dropLines) {
      expect(allowed).toContain(table);
    }
  });
});
