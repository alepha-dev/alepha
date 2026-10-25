import { describe, it } from "vitest";

import { RehearsalDiff } from "../scripts/rehearsal/RehearsalDiff.ts";

describe("RehearsalDiff", () => {
  const diff = new RehearsalDiff();
  const marked = [
    "-- alepha-allow-drop-table: leaf, nothing references it",
    "DROP TABLE `members`;--> statement-breakpoint",
    "DROP TABLE `invitations`;",
  ].join("\n");

  it("reads only the drops a marker sits directly above", ({ expect }) => {
    expect(diff.markedDrops(marked)).toEqual(["members"]);
  });

  it("passes when nothing moved and the bookkeeping grew by one per migration", ({
    expect,
  }) => {
    const report = diff.compare(
      { d1_migrations: 100, quests: 5, members: 3 },
      { d1_migrations: 101, quests: 5 },
      [marked],
    );

    expect(report.failures).toEqual([]);
    expect(report.rows).toEqual([
      { table: "d1_migrations", before: 100, after: 101, status: "same" },
      { table: "members", before: 3, status: "dropped" },
      { table: "quests", before: 5, after: 5, status: "same" },
    ]);
  });

  it("fails when a surviving table's count changes", ({ expect }) => {
    const report = diff.compare(
      { d1_migrations: 1, quests: 5, quest_comments: 9 },
      { d1_migrations: 2, quests: 5, quest_comments: 0 },
      ["ALTER TABLE `quests` DROP COLUMN `note`;"],
    );

    expect(report.failures).toEqual(["quest_comments went from 9 rows to 0"]);
  });

  /**
   * A backfill grows its table on purpose (#Q2626), and says so with a
   * marker directly above its INSERT. The marker allows growth only: the
   * same table losing rows still fails, and an unmarked table still fails.
   */
  it("lets a marked backfill grow its table, and nothing else", ({
    expect,
  }) => {
    const backfill = [
      "ALTER TABLE `folio_links` ADD `relation` text;--> statement-breakpoint",
      "-- alepha-rehearse-allow-insert: one filed row per folio with an epic",
      "INSERT OR IGNORE INTO `folio_links` (`from_type`) SELECT 'epic' FROM `folios`;",
      "INSERT INTO `quests` (`id`) SELECT 1;",
    ].join("\n");
    expect(diff.markedInserts(backfill)).toEqual(["folio_links"]);

    const grown = diff.compare(
      { d1_migrations: 1, folio_links: 10, quests: 5 },
      { d1_migrations: 2, folio_links: 14, quests: 5 },
      [backfill],
    );
    expect(grown.failures).toEqual([]);
    expect(grown.rows[1]).toEqual({
      table: "folio_links",
      before: 10,
      after: 14,
      status: "grown",
    });

    const shrunk = diff.compare(
      { d1_migrations: 1, folio_links: 10, quests: 5 },
      { d1_migrations: 2, folio_links: 9, quests: 6 },
      [backfill],
    );
    expect(shrunk.failures).toEqual([
      "folio_links went from 10 rows to 9",
      "quests went from 5 rows to 6",
    ]);
  });

  it("fails when a table vanishes that no marker names", ({ expect }) => {
    const report = diff.compare(
      { d1_migrations: 1, invitations: 2 },
      { d1_migrations: 2 },
      [marked],
    );

    expect(report.failures).toEqual([
      "invitations disappeared and no alepha-allow-drop-table marker names it",
    ]);
  });

  it("fails when the bookkeeping does not match the applied migrations", ({
    expect,
  }) => {
    const report = diff.compare({ d1_migrations: 1 }, { d1_migrations: 1 }, [
      "SELECT 1;",
    ]);

    expect(report.failures).toEqual([
      "d1_migrations holds 1 rows, expected 2 (one per applied migration)",
    ]);
  });

  it("lists a table the migrations created without failing", ({ expect }) => {
    const report = diff.compare(
      { d1_migrations: 1 },
      { d1_migrations: 2, releases: 0 },
      ["CREATE TABLE `releases` (`id` integer);"],
    );

    expect(report.failures).toEqual([]);
    expect(report.rows).toContainEqual({
      table: "releases",
      after: 0,
      status: "new",
    });
  });
});
