import { Alepha, AlephaError, z } from "alepha";
import { CliProvider } from "alepha/command";
import { $entity, $repository, db } from "alepha/orm";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { DbCommand } from "../commands/db.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

/**
 * Exposes the destructive-migration guard so it can be driven without booting
 * a real app + drizzle-kit.
 */
class TestDbCommand extends DbCommand {
  public testAssertNoDestructiveMigrations =
    this.assertNoDestructiveMigrations.bind(this);
  public testArchiveMigrations = this.archiveMigrations.bind(this);
  public readonly testBaselineMark = this.baselineMark;
}

/**
 * Stands in for the Vite-backed loader so `baselineMark` can be driven
 * against a pre-built user container instead of a real project on disk —
 * same pattern as `GenCommands.spec.ts`.
 */
class FakeCliUtils extends AlephaCliUtils {
  public userAlepha?: Alepha;

  public override async loadAlephaFromServerEntryFile(): Promise<Alepha> {
    if (!this.userAlepha) {
      throw new AlephaError("test did not provide a user container");
    }
    return this.userAlepha;
  }
}

const widgets = $entity({
  name: "widgets",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
  }),
});

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

  /**
   * Baselining must never destroy history — the old migrations move aside so
   * they stay readable in git, rather than being deleted.
   */
  describe("archiveMigrations", () => {
    it("moves sql files and meta into .archive and reports them", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0000_first.sql",
        "CREATE TABLE a(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/0001_second.sql",
        "CREATE TABLE b(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/meta/_journal.json",
        '{"entries":[]}',
      );

      const archived = await db.testArchiveMigrations("/app/migrations/sqlite");

      expect(archived).toEqual(["0000_first.sql", "0001_second.sql"]);
      expect(
        await fs.exists("/app/migrations/sqlite/.archive/0000_first.sql"),
      ).toBe(true);
      expect(
        await fs.exists("/app/migrations/sqlite/.archive/0001_second.sql"),
      ).toBe(true);
      expect(
        await fs.exists("/app/migrations/sqlite/.archive/meta/_journal.json"),
      ).toBe(true);
      expect(await fs.exists("/app/migrations/sqlite/0000_first.sql")).toBe(
        false,
      );
      expect(await fs.exists("/app/migrations/sqlite/meta/_journal.json")).toBe(
        false,
      );
    });

    it("returns an empty list when there is nothing to archive", async () => {
      const { db } = create();

      expect(await db.testArchiveMigrations("/app/migrations/sqlite")).toEqual(
        [],
      );
    });

    it("refuses to overwrite an existing archive", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0000_first.sql",
        "CREATE TABLE a(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/.archive/0000_old.sql",
        "CREATE TABLE old(id integer);",
      );

      await expect(
        db.testArchiveMigrations("/app/migrations/sqlite"),
      ).rejects.toThrowError(/already exists/);
    });
  });

  /**
   * Cloudflare D1 doesn't go through drizzle's migrator at all — its
   * deploy path is driven by `WranglerApi.d1MigrationsBaseline`, reachable
   * only via `alepha platform db baseline mark` (it needs project/env/
   * tenant naming that core `alepha db` can't resolve; see Task 4's
   * report). Core `baseline mark` must redirect a D1-driver provider there
   * instead of letting it fall through to `DatabaseProvider`'s generic
   * "driver not supported" error, which would wrongly imply the capability
   * doesn't exist anywhere.
   */
  describe("baselineMark", () => {
    /**
     * `AppEntryProvider.getAppEntry(root)` runs (against a real project's
     * `FileSystemProvider`) before the faked `loadAlephaFromServerEntryFile`
     * ever gets control, so most tests here use `MemoryFileSystemProvider`
     * with a stub entry file written into it. The one test that needs
     * drizzle's migrator to see a real migration file on real disk opts out
     * via `realFs` instead — drizzle reads real `node:fs`, not Alepha's
     * `FileSystemProvider` abstraction.
     */
    const createWithUserApp = (options: { realFs?: boolean } = {}) => {
      let alepha = Alepha.create().with({
        provide: AlephaCliUtils,
        use: FakeCliUtils,
      });
      if (!options.realFs) {
        alepha = alepha.with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });
      }

      const utils = alepha.inject(FakeCliUtils);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestDbCommand);

      return { alepha, utils, cli, cmd };
    };

    it("redirects a D1 provider to 'alepha platform db baseline mark' instead of connecting", async () => {
      const { alepha, utils, cli, cmd } = createWithUserApp();
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile("/project/src/main.server.ts", "export default {};");

      const userAlepha = Alepha.create({
        env: { DATABASE_URL: "d1://DB" },
      });
      class App {
        widgets = $repository(widgets);
      }
      // Deliberately not started — a D1 connect would fail outside a real
      // Workers runtime anyway; the point is the guard fires before that.
      userAlepha.inject(App);
      utils.userAlepha = userAlepha;

      await expect(
        cli.run(cmd.testBaselineMark, { root: "/project", argv: "" }),
      ).rejects.toThrowError(/alepha platform db baseline mark/);
    });

    /**
     * Regression guard: the D1 redirect must not swallow the normal path
     * for the drivers `markBaselineApplied` actually supports today.
     * drizzle's migrator reads migration files from real disk regardless of
     * which `FileSystemProvider` the CLI container uses, so this test (like
     * `orm/core/__tests__/baseline-mark.spec.ts`) writes into a real temp
     * directory rather than `MemoryFileSystemProvider`.
     */
    it("still marks a non-D1 provider normally", async () => {
      const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import(
        "node:fs"
      );
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const root = mkdtempSync(join(tmpdir(), "alepha-db-baseline-mark-"));
      const migrationDir = join(root, "migrations", "sqlite", "0000_baseline");
      mkdirSync(migrationDir, { recursive: true });
      writeFileSync(
        join(migrationDir, "migration.sql"),
        "CREATE TABLE `widgets` (`id` integer PRIMARY KEY, `name` text NOT NULL);",
      );
      // `entryProvider.getAppEntry(root)` runs against the real
      // FileSystemProvider before `loadAlephaFromServerEntryFile` (which is
      // faked) ever gets control — it still needs *something* to find.
      const srcDir = join(root, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "main.server.ts"), "export default {};");

      try {
        const { utils, cli, cmd } = createWithUserApp({ realFs: true });

        // File-backed, not `:memory:` — `baselineMark` closes the
        // connection when it's done (mirroring `push --dry-run`), and an
        // in-memory sqlite database's contents vanish on close. A real
        // file lets this test reconnect afterwards to verify the row.
        const dbPath = join(root, "test.db");
        const userAlepha = Alepha.create({
          env: { DATABASE_URL: `sqlite://${dbPath}`, DATABASE_SYNC: false },
        });
        class App {
          widgets = $repository(widgets);
        }
        userAlepha.inject(App);
        // Deliberately not started, mirroring the CLI's real precondition
        // (see baseline-mark.spec.ts) — `baselineMark` connects explicitly.
        utils.userAlepha = userAlepha;

        await cli.run(cmd.testBaselineMark, { root, argv: "" });

        const { DatabaseProvider, sql } = await import("alepha/orm");
        const provider = userAlepha.inject(DatabaseProvider);
        await provider.connect?.();
        try {
          const bookkeeping = await provider.execute(
            sql`SELECT name FROM __drizzle_migrations`,
          );
          expect(bookkeeping).toHaveLength(1);
        } finally {
          await provider.close?.();
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("no longer declares a --reset flag", () => {
      const { cmd } = createWithUserApp();

      const shape = (cmd.testBaselineMark.flags as unknown as { shape: object })
        .shape;
      expect(Object.keys(shape)).not.toContain("reset");
    });
  });
});
