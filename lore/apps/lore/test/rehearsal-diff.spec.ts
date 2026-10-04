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
