import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the Sigils foundation migration against the D1 cascade-wipe bomb.
 *
 * Cloudflare D1 ignores `PRAGMA foreign_keys=OFF`, so a migration that
 * contains `DROP TABLE` triggers `ON DELETE CASCADE` on every referencing
 * child row and can wipe production. The Sigils entity must ship as a pure
 * additive `CREATE TABLE` — no rebuild, no `DROP TABLE`.
 *
 * See CLAUDE.md "Migration safety on D1".
 */
const migrationPath = fileURLToPath(
  new URL("../migrations/sqlite/0019_clear_rocket_racer.sql", import.meta.url),
);

describe("sigils migration safety", () => {
  const sql = readFileSync(migrationPath, "utf-8");

  it("contains no DROP TABLE statement", () => {
    const offenders = sql
      .split("\n")
      .filter((line) => /^\s*DROP\s+TABLE/i.test(line));
    expect(offenders).toEqual([]);
  });

  it("creates the sigils table", () => {
    expect(sql).toMatch(/CREATE TABLE\s+`?sigils`?/i);
  });
});
