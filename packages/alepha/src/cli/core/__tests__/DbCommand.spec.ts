import { delimiter, dirname } from "node:path";

import { Alepha, AlephaError, z } from "alepha";
import { CliProvider, CommandError } from "alepha/command";
import { $entity, $repository, db } from "alepha/orm";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  NodeFileSystemProvider,
} from "alepha/system";
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
  public testFindDestructiveMigrations =
    this.findDestructiveMigrations.bind(this);
  public testArchiveMigrations = this.archiveMigrations.bind(this);
  public testResolveLastSnapshot = this.resolveLastSnapshot.bind(this);
  public testMigrationsLayout = this.migrationsLayout.bind(this);
  public testResolveMigrationSqlPath = this.resolveMigrationSqlPath.bind(this);
  public testStripPublicSchemaFromMigrations =
    this.stripPublicSchemaFromMigrations.bind(this);
  public testPrepareDrizzleOrmResolution =
    this.prepareDrizzleOrmResolution.bind(this);
  public readonly testBaselineMark = this.baselineMark;
  public readonly testCreate = this.create;
  public testFindRepositoryProvider = this.findRepositoryProvider.bind(this);
  public testRequireDatabase = this.requireDatabase.bind(this);
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
    id: db.primaryKey(z.integer()),
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
      utils: alepha.inject(AlephaCliUtils),
    };
  };

  /**
   * A project with no ORM is an ordinary project, not a broken one. What it
   * used to get was `Service not found: DrizzleKitProvider` under "Alepha
   * failed to start", naming an internal of a container the user never wrote.
   */
  describe("resolving the database", () => {
    it("should report an absent ORM without naming a container internal", () => {
      const { db } = create();
      const userAlepha = Alepha.create();

      expect(() => db.testRequireDatabase(userAlepha, "push to")).toThrowError(
        /No database configured, so there is nothing to push to/,
      );
      expect(() =>
        db.testRequireDatabase(userAlepha, "push to"),
      ).not.toThrowError(/Service not found/);
    });

    /**
     * A command failure, so `CliProvider` renders the reason and exits 1
     * instead of unwinding a stack through its own internals.
     */
    it("should report it as a command failure", () => {
      const { db } = create();

      expect(() => db.testRequireDatabase(Alepha.create(), "baseline")).toThrow(
        CommandError,
      );
    });

    /**
     * `check` asks a question, and "no database" answers it: `alepha verify`
     * runs the check unconditionally and must stay green on a DB-less app.
     */
    it("should answer with undefined for the commands that tolerate it", () => {
      const { db } = create();

      expect(db.testFindRepositoryProvider(Alepha.create())).toBeUndefined();
    });
  });

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

    /**
     * The caller passes top-level directory ENTRY NAMES (from an `ls`
     * diff), not filenames. Under drizzle-kit v1 a newly generated
     * migration is a folder (`<tag>/migration.sql`), so an entry-name
     * filter of `.endsWith(".sql")` drops it before its content is ever
     * read — the guard runs, finds nothing, and reports clean regardless
     * of what the migration actually contains. This is the only automated
     * defence against the D1 cascade-wipe bomb, so a v1-layout migration
     * containing DROP TABLE must be caught, not silently waved through.
     */
    it("rejects a v1-layout migration folder containing DROP TABLE", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_drop_it/migration.sql",
        'ALTER TABLE "quests" ADD COLUMN "note" text;\nDROP TABLE "campaigns";',
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_drop_it/snapshot.json",
        "{}",
      );

      await expect(
        db.testAssertNoDestructiveMigrations("/app/migrations/sqlite", [
          "20260729140502_drop_it",
        ]),
      ).rejects.toThrowError(/DROP TABLE/);
    });

    it("accepts a v1-layout migration folder with no table drops", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_add_col/migration.sql",
        'ALTER TABLE "quests" ADD COLUMN "note" text;',
      );

      await expect(
        db.testAssertNoDestructiveMigrations("/app/migrations/sqlite", [
          "20260729140502_add_col",
        ]),
      ).resolves.toBeUndefined();
    });
  });

  /**
   * The scan `migrations check` runs, over every migration already on disk.
   *
   * `assertNoDestructiveMigrations` above fires once, at generate time, over
   * files new since that run, on one developer's laptop. After that nothing
   * looked at the file again: accepting a drop by keeping the file silenced
   * the guard forever, since a re-run finds no schema diff to regenerate,
   * and there was no record of the decision anywhere.
   *
   * It also matters that this one runs on every `yarn v` and in CI. The
   * guard has already been silently inert once, when `generate` moved to
   * drizzle-kit v1's folder layout and the entry filter stopped matching
   * anything (see `resolveMigrationSqlPath`). A check that only ever runs at
   * one moment on one machine has no second chance to notice that.
   */
  describe("findDestructiveMigrations", () => {
    it("flags a pre-existing migration, not just a freshly generated one", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        'DROP TABLE "legacy";',
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toEqual(['  0001_old.sql: DROP TABLE "legacy";']);
    });

    it("accepts a drop excused by a marker on the line above", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        '-- alepha-allow-drop-table: a leaf table nothing references\nDROP TABLE "legacy";',
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toEqual([]);
    });

    it("excuses only the statement directly under the marker", async () => {
      // A marker that has drifted away from its statement is not a marker:
      // it would go on excusing whatever ended up underneath it.
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        [
          "-- alepha-allow-drop-table: only covers the next line",
          'DROP TABLE "excused";',
          'DROP TABLE "not_excused";',
        ].join("\n"),
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toEqual(['  0001_old.sql: DROP TABLE "not_excused";']);
    });

    it("accepts a marker whose reason wraps onto further comment lines", async () => {
      // The first three files this rule was applied to all needed a reason
      // longer than one line, and a look-back of exactly one line silently
      // disarmed every one of them. A wrapped reason must not be a disarmed
      // marker.
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        [
          "-- alepha-allow-drop-table: a leaf table, nothing in the schema",
          "-- references it, so the D1 cascade has nothing to fire on",
          'DROP TABLE "legacy";',
        ].join("\n"),
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toEqual([]);
    });

    it("does not count a marker separated by a blank line", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        '-- alepha-allow-drop-table: reason\n\nDROP TABLE "legacy";',
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toHaveLength(1);
    });

    it("does not count a marker placed after the statement", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        'DROP TABLE "legacy";\n-- alepha-allow-drop-table: too late',
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toHaveLength(1);
    });

    it("requires the marker to carry a reason", async () => {
      // An empty marker is a way to silence the guard without saying
      // anything, which is the state this whole quest exists to end.
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        '-- alepha-allow-drop-table:\nDROP TABLE "legacy";',
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toHaveLength(1);
    });

    it("still skips .archive/, which is history rather than a migration", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/.archive/0001_baselined.sql",
        'DROP TABLE "legacy";',
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          ".archive",
        ]),
      ).toEqual([]);
    });

    it("reads a v1 folder layout as well as a flat file", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_drop_it/migration.sql",
        'DROP TABLE "campaigns";',
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "20260729140502_drop_it",
        ]),
      ).toEqual(['  20260729140502_drop_it: DROP TABLE "campaigns";']);
    });

    it("excuses a drop that carries a trailing statement-breakpoint", async () => {
      // The real shape in this repo: drizzle appends its breakpoint to the
      // statement line, so the marker's preceding line is the one before the
      // whole `DROP ...;--> statement-breakpoint` run.
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_old.sql",
        [
          "-- alepha-allow-drop-table: child, parent of nothing",
          "DROP TABLE `sigil_views`;--> statement-breakpoint",
          "-- alepha-allow-drop-table: children all dropped above",
          "DROP TABLE `sigils`;--> statement-breakpoint",
        ].join("\n"),
      );

      expect(
        await db.testFindDestructiveMigrations("/app/migrations/sqlite", [
          "0001_old.sql",
        ]),
      ).toEqual([]);
    });
  });

  /**
   * drizzle-kit generates `REFERENCES "public"."table"(...)` even for
   * schema-free models, which breaks a non-public `search_path` deploy.
   * Like the destructive-migration guard above, this used to filter
   * directory entries by `.endsWith(".sql")` — dead on arrival for
   * drizzle-kit v1's folder-per-migration layout.
   */
  describe("stripPublicSchemaFromMigrations", () => {
    it("strips public schema qualifiers from a flat pre-v1 migration file", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0001_init.sql",
        'REFERENCES "public"."users"("id")',
      );

      await db.testStripPublicSchemaFromMigrations("/app/migrations/sqlite");

      expect(
        await fs.readTextFile("/app/migrations/sqlite/0001_init.sql"),
      ).toBe('REFERENCES "users"("id")');
    });

    it("strips public schema qualifiers from a v1-layout migration folder", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_init/migration.sql",
        'REFERENCES "public"."users"("id")',
      );

      await db.testStripPublicSchemaFromMigrations("/app/migrations/sqlite");

      expect(
        await fs.readTextFile(
          "/app/migrations/sqlite/20260729140502_init/migration.sql",
        ),
      ).toBe('REFERENCES "users"("id")');
    });
  });

  describe("resolveMigrationSqlPath", () => {
    it("resolves a flat '<name>.sql' entry to itself", async () => {
      const { db, fs } = create();
      await fs.writeFile("/app/migrations/sqlite/0001_init.sql", "CREATE;");

      expect(
        await db.testResolveMigrationSqlPath(
          "/app/migrations/sqlite",
          "0001_init.sql",
        ),
      ).toBe("/app/migrations/sqlite/0001_init.sql");
    });

    it("resolves a v1 folder entry to its migration.sql", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_init/migration.sql",
        "CREATE;",
      );

      expect(
        await db.testResolveMigrationSqlPath(
          "/app/migrations/sqlite",
          "20260729140502_init",
        ),
      ).toBe("/app/migrations/sqlite/20260729140502_init/migration.sql");
    });

    it("returns null for an entry that is neither a .sql file nor a migration folder", async () => {
      const { db } = create();

      expect(
        await db.testResolveMigrationSqlPath("/app/migrations/sqlite", "meta"),
      ).toBeNull();
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

    /**
     * Every project this branch touches is v1-native from here on — a flat
     * `.sql`-only archive silently no-ops on a first baseline (returns `[]`,
     * never creates `.archive/`) and `generate --name=baseline` then runs
     * against the still-present v1 history, producing an INCREMENTAL
     * migration mislabeled "baseline". `archiveMigrations` must move v1
     * folders (`<tag>/migration.sql`, `<tag>/snapshot.json`) aside too, not
     * only flat `.sql` files.
     */
    it("moves a v1 folder-per-migration layout into .archive, file by file", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260101000000_baseline/migration.sql",
        "CREATE TABLE a(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260101000000_baseline/snapshot.json",
        '{"id":"baseline"}',
      );

      const archived = await db.testArchiveMigrations("/app/migrations/sqlite");

      expect(archived).toEqual(["20260101000000_baseline"]);
      expect(
        await fs.exists(
          "/app/migrations/sqlite/.archive/20260101000000_baseline/migration.sql",
        ),
      ).toBe(true);
      expect(
        await fs.exists(
          "/app/migrations/sqlite/.archive/20260101000000_baseline/snapshot.json",
        ),
      ).toBe(true);
      expect(
        await fs.exists(
          "/app/migrations/sqlite/20260101000000_baseline/migration.sql",
        ),
      ).toBe(false);
      expect(
        await fs.exists(
          "/app/migrations/sqlite/20260101000000_baseline/snapshot.json",
        ),
      ).toBe(false);
    });

    it("archives flat .sql files and v1 folders together, and reports both", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0000_first.sql",
        "CREATE TABLE a(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260101000000_baseline/migration.sql",
        "CREATE TABLE b(id integer);",
      );

      const archived = await db.testArchiveMigrations("/app/migrations/sqlite");

      expect(archived).toEqual(["0000_first.sql", "20260101000000_baseline"]);
      expect(
        await fs.exists("/app/migrations/sqlite/.archive/0000_first.sql"),
      ).toBe(true);
      expect(
        await fs.exists(
          "/app/migrations/sqlite/.archive/20260101000000_baseline/migration.sql",
        ),
      ).toBe(true);
    });
  });

  /**
   * `alepha db migrations check` diffs the current schema against the most
   * recently recorded snapshot. drizzle-kit v1 changed where that snapshot
   * lives (one folder per migration, no `meta/_journal.json`), and
   * `drizzle-orm@1`'s runtime migrator refuses to even read the old layout.
   * `resolveLastSnapshot` must understand both, or `check` silently stops
   * comparing anything the moment a project's migrations are regenerated
   * or baselined under v1.
   */
  describe("resolveLastSnapshot", () => {
    it("reads the last snapshot from a pre-v1 journal + meta layout", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/meta/_journal.json",
        JSON.stringify({
          entries: [
            { idx: 0, tag: "0000_first" },
            { idx: 1, tag: "0001_second" },
          ],
        }),
      );
      await fs.writeFile(
        "/app/migrations/sqlite/meta/0000_snapshot.json",
        JSON.stringify({ id: "old" }),
      );
      await fs.writeFile(
        "/app/migrations/sqlite/meta/0001_snapshot.json",
        JSON.stringify({ id: "latest" }),
      );

      const snapshot = await db.testResolveLastSnapshot(
        "/app/migrations/sqlite",
      );

      expect(snapshot).toEqual({ id: "latest" });
    });

    it("returns null when a pre-v1 journal exists but records nothing yet", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/meta/_journal.json",
        JSON.stringify({ entries: [] }),
      );

      expect(
        await db.testResolveLastSnapshot("/app/migrations/sqlite"),
      ).toBeNull();
    });

    it("reads the last snapshot from a v1 folder-per-migration layout", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260101000000_baseline/migration.sql",
        "CREATE TABLE a(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260101000000_baseline/snapshot.json",
        JSON.stringify({ id: "baseline" }),
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260201000000_add_widgets/migration.sql",
        "CREATE TABLE widgets(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260201000000_add_widgets/snapshot.json",
        JSON.stringify({ id: "latest" }),
      );

      const snapshot = await db.testResolveLastSnapshot(
        "/app/migrations/sqlite",
      );

      expect(snapshot).toEqual({ id: "latest" });
    });

    it("returns null when there is nothing to compare in either layout", async () => {
      const { db } = create();

      expect(
        await db.testResolveLastSnapshot("/app/migrations/sqlite"),
      ).toBeNull();
    });

    /**
     * A project mid-upgrade has both: a `meta/_journal.json` from before
     * v1, and a v1 folder from an `alepha db migrations create` run after
     * upgrading. v1's `generate` never touches `meta/_journal.json` again,
     * so the journal is frozen the instant a v1 folder exists — it can only
     * be stale from that point on. The v1 folder must win, or `check`
     * compares against a snapshot a later migration already superseded,
     * reports drift that migration already covers, and `create` would
     * generate a duplicate on top of it.
     */
    it("prefers a newer v1 folder over a stale pre-v1 journal", async () => {
      const { db, fs } = create();
      // Pre-v1 history: journal points at the old snapshot.
      await fs.writeFile(
        "/app/migrations/sqlite/meta/_journal.json",
        JSON.stringify({ entries: [{ idx: 0, tag: "0000_first" }] }),
      );
      await fs.writeFile(
        "/app/migrations/sqlite/meta/0000_snapshot.json",
        JSON.stringify({ id: "stale-pre-v1" }),
      );
      // A v1 migration generated after the upgrade — newer, but the
      // journal has no idea it exists.
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_add_widgets/migration.sql",
        "CREATE TABLE widgets(id integer);",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260729140502_add_widgets/snapshot.json",
        JSON.stringify({ id: "current" }),
      );

      const snapshot = await db.testResolveLastSnapshot(
        "/app/migrations/sqlite",
      );

      expect(snapshot).toEqual({ id: "current" });
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
      if (options.realFs) {
        // Tests default to MemoryFileSystemProvider; this one writes a real
        // migration tree for drizzle (raw node:fs), so opt back into disk.
        alepha = alepha.with({
          provide: FileSystemProvider,
          use: NodeFileSystemProvider,
        });
      } else {
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
      const { mkdirSync, mkdtempSync, rmSync, writeFileSync } =
        await import("node:fs");
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

  describe("migrations create", () => {
    /**
     * `--hints` carries a JSON document, not a label. drizzle-kit demands
     * every ambiguous rename-vs-create in a diff be resolved in a SINGLE
     * invocation, so rewriting one entity family already needs a dozen
     * entries — far past `z.text()`'s default 255-character cap, which
     * rejected the flag outright rather than truncating it.
     */
    it("accepts a --hints array long enough to resolve a whole entity family", () => {
      const { db } = create();

      const hints = JSON.stringify(
        Array.from({ length: 11 }, (_, index) => ({
          type: "create",
          kind: "column",
          entity: ["public", "sigils", `column_${index}`],
        })),
      );
      expect(hints.length).toBeGreaterThan(255);

      const flags = db.testCreate.flags as unknown as {
        safeParse: (value: unknown) => { success: boolean };
      };
      expect(flags.safeParse({ hints }).success).toBe(true);
    });
  });

  /**
   * Drizzle v1 reads a pre-v1 snapshot happily but emits constraints
   * differently from the version that wrote it, so `check` derives a diff for
   * tables nobody touched. Knowing which layout the folder uses is what lets
   * the command say that out loud instead of reporting it as schema drift —
   * on D1 the difference is a table rebuild that cascades to child rows.
   */
  describe("migrationsLayout", () => {
    it("detects the v1 layout from a per-migration snapshot", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/20260101120000_init/snapshot.json",
        JSON.stringify({ id: "a" }),
      );

      expect(await db.testMigrationsLayout("/app/migrations/sqlite")).toBe(
        "v1",
      );
    });

    it("detects the pre-v1 layout from meta/_journal.json", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/0000_init.sql",
        "CREATE TABLE a();",
      );
      await fs.writeFile(
        "/app/migrations/sqlite/meta/_journal.json",
        JSON.stringify({ entries: [{ idx: 0 }] }),
      );

      expect(await db.testMigrationsLayout("/app/migrations/sqlite")).toBe(
        "legacy",
      );
    });

    it("prefers v1 when both shapes are present mid-upgrade", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/meta/_journal.json",
        JSON.stringify({ entries: [{ idx: 0 }] }),
      );
      await fs.writeFile(
        "/app/migrations/sqlite/20260101120000_init/snapshot.json",
        JSON.stringify({ id: "a" }),
      );

      expect(await db.testMigrationsLayout("/app/migrations/sqlite")).toBe(
        "v1",
      );
    });

    it("reports none for an empty or missing folder", async () => {
      const { db } = create();
      expect(await db.testMigrationsLayout("/app/migrations/sqlite")).toBe(
        "none",
      );
    });

    it("ignores archived migrations when deciding", async () => {
      const { db, fs } = create();
      await fs.writeFile(
        "/app/migrations/sqlite/.archive/20250101120000_old/snapshot.json",
        JSON.stringify({ id: "old" }),
      );

      expect(await db.testMigrationsLayout("/app/migrations/sqlite")).toBe(
        "none",
      );
    });
  });

  /**
   * drizzle-kit imports `drizzle-orm` at runtime without declaring it, so it
   * only works when the installer hoists both to the same `node_modules/`.
   * Yarn and pnpm do not, and `alepha db migrations create` died with
   * `Cannot find module 'drizzle-orm/_relations'` in every freshly installed
   * project. Both mechanisms are load-bearing: NODE_PATH for the CJS require,
   * the resolve hook for the `await import(...)` that ignores it.
   */
  describe("prepareDrizzleOrmResolution", () => {
    it("writes a resolver hook pointing at alepha's own drizzle-orm", async () => {
      const { db, fs } = create();

      const { hookUrl } = await db.testPrepareDrizzleOrmResolution("/app");

      const hook = await fs.readTextFile(
        "/app/node_modules/.alepha/drizzle-orm-resolver.mjs",
      );
      expect(hook).toContain("registerHooks");
      expect(hook).toContain('startsWith("drizzle-orm/")');
      expect(hook).toMatch(
        /createRequire\("file:\/\/.*drizzle-orm\/package\.json"\)/,
      );
      expect(hookUrl).toMatch(/^file:\/\/.*drizzle-orm-resolver\.mjs$/);
    });

    it("guards the hook so older runtimes without registerHooks still boot", async () => {
      const { db, fs } = create();

      await db.testPrepareDrizzleOrmResolution("/app");

      const hook = await fs.readTextFile(
        "/app/node_modules/.alepha/drizzle-orm-resolver.mjs",
      );
      expect(hook).toContain('typeof registerHooks === "function"');
    });

    it("points NODE_PATH at the directory holding drizzle-orm", async () => {
      const { db, utils } = create();

      const { nodePath } = await db.testPrepareDrizzleOrmResolution("/app");

      expect(nodePath.split(delimiter)[0]).toBe(
        dirname(utils.resolvePackageDir("drizzle-orm")),
      );
    });

    it("prepends to a NODE_PATH the user already set rather than replacing it", async () => {
      const { db } = create();
      const previous = process.env.NODE_PATH;
      process.env.NODE_PATH = "/somewhere/of/their/own";

      try {
        const { nodePath } = await db.testPrepareDrizzleOrmResolution("/app");

        const entries = nodePath.split(delimiter);
        expect(entries).toHaveLength(2);
        expect(entries[1]).toBe("/somewhere/of/their/own");
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_PATH;
        } else {
          process.env.NODE_PATH = previous;
        }
      }
    });
  });

  /**
   * Every `db` command declared an optional positional `path` that no handler
   * had read since 9bc0f640e: `alepha db push ./other` silently ran against
   * the default root, and the help advertised an argument that did nothing.
   *
   * With the declaration gone, `CliProvider`'s "takes no positional
   * arguments" gate covers them - so this asserts the declaration is absent
   * rather than re-testing the gate, which `$command.spec.ts` already pins.
   */
  describe("positional arguments", () => {
    const walk = (command: any): any[] => [
      command,
      ...(command.options.children ?? []).flatMap(walk),
    ];

    it("declares none, on any command in the tree", () => {
      const { db } = create();

      const withArgs = walk(db.db)
        .filter((it) => it.options.args)
        .map((it) => it.options.name);

      expect(withArgs).toEqual([]);
    });

    it("still covers every command - the walk is not vacuous", () => {
      const { db } = create();

      expect(walk(db.db).map((it) => it.options.name)).toEqual(
        expect.arrayContaining([
          "db",
          "migrations",
          "check",
          "create",
          "apply",
          "baseline",
          "mark",
          "push",
          "studio",
        ]),
      );
    });
  });
});
