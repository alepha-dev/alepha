import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { DbCommand } from "../commands/db.ts";

/**
 * Exposes the destructive-migration guard so it can be driven without booting
 * a real app + drizzle-kit.
 */
class TestDbCommand extends DbCommand {
  public testAssertNoDestructiveMigrations =
    this.assertNoDestructiveMigrations.bind(this);
}

describe("DbCommand", () => {
  const create = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      db: alepha.inject(TestDbCommand),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  /**
   * D1 ignores `PRAGMA foreign_keys=OFF`, so a generated migration that drops a
   * CASCADE parent silently wipes every child row on deploy. Today the only
   * defence is a human remembering to grep the migration before pushing.
   */
  describe("assertNoDestructiveMigrations", () => {
    it("rejects a newly generated migration containing DROP TABLE", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0042_drop_it.sql",
        'ALTER TABLE "quests" ADD COLUMN "note" text;\nDROP TABLE "campaigns";',
      );

      await expect(
        db.testAssertNoDestructiveMigrations("/app/migrations/sqlite", [
          "0042_drop_it.sql",
        ]),
      ).rejects.toThrowError(/DROP TABLE/);
    });

    it("names the offending file so it can be reviewed", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0042_drop_it.sql",
        'DROP TABLE IF EXISTS "campaigns";',
      );

      await expect(
        db.testAssertNoDestructiveMigrations("/app/migrations/sqlite", [
          "0042_drop_it.sql",
        ]),
      ).rejects.toThrowError(/0042_drop_it\.sql/);
    });

    it("accepts a migration with no table drops", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0043_add_col.sql",
        'ALTER TABLE "quests" ADD COLUMN "note" text;',
      );

      await expect(
        db.testAssertNoDestructiveMigrations("/app/migrations/sqlite", [
          "0043_add_col.sql",
        ]),
      ).resolves.toBeUndefined();
    });

    it("ignores DROP TABLE inside a SQL comment", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0044_comment.sql",
        '-- DROP TABLE "campaigns"; (kept for reference)\nALTER TABLE "quests" ADD COLUMN "note" text;',
      );

      await expect(
        db.testAssertNoDestructiveMigrations("/app/migrations/sqlite", [
          "0044_comment.sql",
        ]),
      ).resolves.toBeUndefined();
    });

    it("does not flag pre-existing migrations, only the newly generated ones", async () => {
      const { db, fs } = create();
      // An old, already-applied migration that legitimately dropped a table.
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        'DROP TABLE "legacy";',
      );
      await fs.writeFile(
        "/app/migrations/sqlite/0045_new.sql",
        'ALTER TABLE "quests" ADD COLUMN "note" text;',
      );

      await expect(
        db.testAssertNoDestructiveMigrations("/app/migrations/sqlite", [
          "0045_new.sql",
        ]),
      ).resolves.toBeUndefined();
    });
  });
});
