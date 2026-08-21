import { join as nodeJoin } from "node:path";

import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { WranglerApi } from "../services/WranglerApi.ts";

/**
 * D1 migrations must NOT go through `wrangler d1 migrations apply`.
 *
 * That command runs each migration inside a transaction — its own help
 * says "this migration will be rolled back" on error — and SQLite
 * **ignores `PRAGMA foreign_keys` inside a transaction**. drizzle-kit
 * opens every generated table-rebuild with `PRAGMA foreign_keys=OFF`
 * precisely so the `DROP TABLE` does not cascade, so under
 * `migrations apply` that pragma is void, constraints stay live, and the
 * implicit `DELETE FROM` behind `DROP TABLE` takes every child row with
 * it. The migration then reports success.
 *
 * Measured against a real D1, same migrations and same database:
 *   wrangler d1 migrations apply  ->  0 of 5 child rows survive
 *   wrangler d1 execute --file    ->  5 of 5 survive
 *
 * It destroyed 2434 rows across five tables in a production deploy before
 * being caught, so this test asserts the command choice directly rather
 * than trusting a comment.
 */
const ROOT = "dist/migrations";

/**
 * Models just enough of a real filesystem for migration discovery:
 * `ls(dir)` returns the immediate child names under `dir` (files and
 * directories alike, same as a raw `readdir`), and `exists(path)` is true
 * for both a known file and any directory that has something nested under
 * it. This is what makes the v1 folder-per-migration layout
 * (`<tag>/migration.sql`) distinguishable from a directory that merely
 * *looks* like it might hold one — the bug this whole suite guards against
 * was exactly that distinction being made carelessly.
 */
class FakeFs {
  constructor(protected readonly paths: Set<string>) {}

  join(...parts: string[]) {
    // Match `NodeFileSystemProvider.join`'s real behavior (`path.join`),
    // which normalizes away a leading `.` segment — `join(".", "dist/x")`
    // is `"dist/x"`, not `"./dist/x"`. A naive `parts.join("/")` here would
    // silently desync this fixture's path keys from what the method under
    // test actually looks up.
    return nodeJoin(...parts);
  }

  async exists(path: string) {
    if (this.paths.has(path)) return true;
    return [...this.paths].some((p) => p.startsWith(`${path}/`));
  }

  async ls(dir: string, options?: { hidden?: boolean }) {
    const prefix = `${dir}/`;
    const names = new Set<string>();
    for (const p of this.paths) {
      if (p.startsWith(prefix)) {
        names.add(p.slice(prefix.length).split("/")[0] as string);
      }
    }
    // Match `NodeFileSystemProvider.ls`'s real behavior: dotfiles are
    // hidden unless explicitly requested. A directory holding only
    // `.archive/` must be indistinguishable from a real empty directory
    // ONLY when the caller does not pass `{ hidden: true }`.
    const visible = options?.hidden
      ? [...names]
      : [...names].filter((name) => !name.startsWith("."));
    return visible;
  }
}

describe("d1MigrationsApply", () => {
  const capture = (relativePaths: string[], appliedNames: string[] = []) => {
    const commands: string[] = [];

    class FakeShell {
      async run(command: string) {
        commands.push(command);
        // The applied-migrations lookup expects JSON; everything else can
        // return empty.
        if (command.includes("SELECT name FROM d1_migrations")) {
          return JSON.stringify([
            { results: appliedNames.map((name) => ({ name })) },
          ]);
        }
        return "";
      }
    }

    const paths = new Set(relativePaths.map((p) => `${ROOT}/${p}`));
    const alepha = Alepha.create();
    const api = alepha.inject(WranglerApi);
    // Swap the collaborators the method actually uses.
    Object.assign(api as unknown as Record<string, unknown>, {
      shell: new FakeShell(),
      fs: new FakeFs(paths),
    });

    const call = () =>
      (
        api as unknown as {
          d1MigrationsApply: (
            db: string,
            root?: string,
            dir?: string,
          ) => Promise<void>;
        }
      ).d1MigrationsApply("mydb", ".", ROOT);

    return { commands, call };
  };

  it("never invokes `d1 migrations apply`", async ({ expect }) => {
    const { commands, call } = capture(["0001_init.sql", "0002_rebuild.sql"]);
    await call();
    expect(commands.some((c) => c.includes("d1 migrations apply"))).toBe(false);
  });

  it("applies each pending migration with `execute --file`", async ({
    expect,
  }) => {
    const { commands, call } = capture(["0001_init.sql", "0002_rebuild.sql"]);
    await call();

    const applied = commands.filter((c) => c.includes("--file="));
    expect(applied).toHaveLength(2);
    expect(applied[0]).toContain("dist/migrations/0001_init.sql");
    expect(applied[1]).toContain("dist/migrations/0002_rebuild.sql");
    // Order matters: a rebuild that runs before its table exists fails.
    expect(applied[0].indexOf("0001")).toBeGreaterThan(-1);
  });

  it("records each applied migration in wrangler's own table", async ({
    expect,
  }) => {
    const { commands, call } = capture(["0001_init.sql"]);
    await call();

    expect(
      commands.some((c) =>
        c.includes("CREATE TABLE IF NOT EXISTS d1_migrations"),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (c) =>
          c.includes("INSERT INTO d1_migrations") &&
          c.includes("0001_init.sql"),
      ),
    ).toBe(true);
  });

  it("applies migrations in sorted order regardless of directory order", async ({
    expect,
  }) => {
    const { commands, call } = capture(["0002_second.sql", "0001_first.sql"]);
    await call();

    const applied = commands
      .filter((c) => c.includes("--file="))
      .map((c) => c.split("--file=")[1]);
    expect(applied).toHaveLength(2);
    expect(applied[0]).toContain("0001_first.sql");
    expect(applied[1]).toContain("0002_second.sql");
  });

  /**
   * A stray non-migration file used to be silently ignored. Now that the
   * anti-silence guard fires on ANY unrecognized entry (see below), a
   * directory that genuinely holds one has to fail loudly instead — the
   * same reasoning that makes a corrupt migration folder unsafe to ignore
   * applies equally to a README nobody meant to leave there.
   */
  it("refuses when the directory holds a non-migration file", async ({
    expect,
  }) => {
    const { call } = capture(["0001_first.sql", "README.md"]);

    await expect(call()).rejects.toThrowError(
      /none are recognizable as migrations/,
    );
  });

  /**
   * drizzle-kit v1 never produces the flat `<name>.sql` layout above — it
   * writes one folder per migration (`<tag>/migration.sql`), and
   * `drizzle-orm@1`'s own runtime migrator refuses to even read the old
   * layout. Discovery must recognise this shape too, or (as happened before
   * this fix) every entry in the directory gets filtered out, "0 pending
   * migrations" is reported, and a deploy silently applies nothing.
   */
  describe("drizzle-kit v1 folder-per-migration layout", () => {
    it("applies a v1 migration, recording the folder name (not 'migration.sql')", async ({
      expect,
    }) => {
      const { commands, call } = capture([
        "20260729013337_baseline/migration.sql",
        "20260729013337_baseline/snapshot.json",
      ]);
      await call();

      const applied = commands.filter((c) => c.includes("--file="));
      expect(applied).toHaveLength(1);
      expect(applied[0]).toContain(
        "dist/migrations/20260729013337_baseline/migration.sql",
      );

      expect(
        commands.some(
          (c) =>
            c.includes("INSERT INTO d1_migrations") &&
            c.includes("VALUES ('20260729013337_baseline')"),
        ),
      ).toBe(true);
      // The bookkeeping name must be the folder, never the literal
      // filename — `d1MigrationsBaseline` must record the exact same
      // string for the two methods to ever agree on "already applied".
      expect(commands.some((c) => c.includes("'migration.sql'"))).toBe(false);
    });

    it("applies pre-v1 and v1 migrations together, in chronological order", async ({
      expect,
    }) => {
      const { commands, call } = capture([
        "0000_old.sql",
        "20260729013337_baseline/migration.sql",
      ]);
      await call();

      const applied = commands
        .filter((c) => c.includes("--file="))
        .map((c) => c.split("--file=")[1]);
      expect(applied).toHaveLength(2);
      expect(applied[0]).toContain("0000_old.sql");
      expect(applied[1]).toContain("20260729013337_baseline/migration.sql");
    });

    it("does not re-run a v1 migration already recorded under its folder name", async ({
      expect,
    }) => {
      const { commands, call } = capture(
        ["20260729013337_baseline/migration.sql"],
        ["20260729013337_baseline"],
      );
      await call();

      expect(commands.some((c) => c.includes("--file="))).toBe(false);
      expect(
        commands.some((c) => c.includes("INSERT INTO d1_migrations")),
      ).toBe(false);
    });

    it("ignores a bare 'meta/' directory (pre-v1 journal/snapshots, no SQL)", async ({
      expect,
    }) => {
      // `meta/_journal.json` existing but nothing else in the directory —
      // legitimately nothing to apply, not an error.
      const { commands, call } = capture(["meta/_journal.json"]);
      await call();

      expect(commands.some((c) => c.includes("--file="))).toBe(false);
    });

    it("refuses to silently apply nothing when the directory holds unrecognisable entries", async ({
      expect,
    }) => {
      // A folder that looks like a v1 migration but has no migration.sql
      // inside it (corrupt/partial), and nothing else recognisable.
      const { call } = capture(["20260729013337_baseline/snapshot.json"]);

      await expect(call()).rejects.toThrowError(
        /none are recognizable as migrations/,
      );
    });

    /**
     * The guard above only fired when discovery found ZERO recognisable
     * migrations. One valid migration alongside one corrupt folder (an
     * aborted `generate`, a bad merge, a partial checkout) left
     * `migrations.length === 1`, so the guard stayed quiet and the corrupt
     * folder was silently dropped from the production deploy while the run
     * reported success — the exact bug class this whole file guards
     * against, one abstraction layer up.
     */
    it("refuses to silently drop a corrupt migration alongside a valid one", async ({
      expect,
    }) => {
      const { call } = capture([
        "20260729013337_baseline/migration.sql",
        "20260801000000_addcol/snapshot.json",
      ]);

      await expect(call()).rejects.toThrowError(
        /none are recognizable as migrations/,
      );
    });

    /**
     * `.archive/` is baselining's own output (`archiveMigrations` in
     * `db.ts`) and never a sign anything is wrong — a directory holding
     * only `.archive/` (plus the empty `meta/` that `archiveMigrations`
     * leaves in place) legitimately has zero pending migrations, the same
     * as a bare `meta/` above. `ls` must be able to SEE `.archive` to make
     * that determination deliberately rather than by the accident of it
     * being invisible either way.
     */
    it("ignores a directory holding only .archive/ (legitimately nothing pending)", async ({
      expect,
    }) => {
      const { commands, call } = capture([".archive/0000_old.sql"]);
      await call();

      expect(commands.some((c) => c.includes("--file="))).toBe(false);
    });

    it("ignores .archive/ when real migrations are present", async ({
      expect,
    }) => {
      const { commands, call } = capture([
        ".archive/0000_old.sql",
        "20260729013337_baseline/migration.sql",
      ]);
      await call();

      const applied = commands.filter((c) => c.includes("--file="));
      expect(applied).toHaveLength(1);
      expect(applied[0]).toContain("20260729013337_baseline/migration.sql");
    });

    /**
     * Before `ls` was called with `{ hidden: true }`, ANY dotfile — not
     * just `.archive` — was invisible to discovery, not only the ones this
     * method explicitly recognises. A stray hidden entry that is neither
     * `.archive` nor `meta` (a leftover `.env.local`, an editor swap dir,
     * anything unexpected) used to be silently invisible right alongside a
     * real migration, rather than failing the same anti-silence guard a
     * visible unrecognisable entry already triggers.
     */
    it("refuses on a stray hidden entry that isn't .archive or meta", async ({
      expect,
    }) => {
      const { call } = capture([
        "20260729013337_baseline/migration.sql",
        ".mystery/leftover",
      ]);

      await expect(call()).rejects.toThrowError(
        /none are recognizable as migrations/,
      );
    });
  });
});

/**
 * The baseline file is pure CREATE TABLE. Recording it must insert a
 * bookkeeping row and run no migration SQL — otherwise the first deploy
 * after a baseline would try to recreate every table on a live database.
 */
describe("d1MigrationsBaseline", () => {
  const capture = (relativePaths: string[], appliedNames: string[]) => {
    const commands: string[] = [];

    class FakeShell {
      async run(command: string) {
        commands.push(command);
        if (command.includes("SELECT name FROM d1_migrations")) {
          return JSON.stringify([
            { results: appliedNames.map((name) => ({ name })) },
          ]);
        }
        return "";
      }
    }

    const paths = new Set(relativePaths.map((p) => `${ROOT}/${p}`));
    const alepha = Alepha.create();
    const api = alepha.inject(WranglerApi);
    Object.assign(api as unknown as Record<string, unknown>, {
      shell: new FakeShell(),
      fs: new FakeFs(paths),
    });

    const call = (opts?: { reset?: boolean }) =>
      (
        api as unknown as {
          d1MigrationsBaseline: (
            db: string,
            root?: string,
            dir?: string,
            opts?: { reset?: boolean },
          ) => Promise<{ replaced: number }>;
        }
      ).d1MigrationsBaseline("mydb", ".", ROOT, opts);

    return { commands, call };
  };

  it("inserts the baseline row and executes no migration file", async ({
    expect,
  }) => {
    const { commands, call } = capture(["0000_baseline.sql"], []);
    await call();

    expect(
      commands.some((c) =>
        c.includes(
          "INSERT INTO d1_migrations (name) VALUES ('0000_baseline.sql')",
        ),
      ),
    ).toBe(true);
    expect(commands.some((c) => c.includes("--file="))).toBe(false);
  });

  it("refuses to replace an existing history without reset", async ({
    expect,
  }) => {
    const { call } = capture(["0000_baseline.sql"], ["0001_old.sql"]);

    await expect(call()).rejects.toThrowError(/--reset/);
  });

  it("replaces an existing history when reset is given", async ({ expect }) => {
    const { commands, call } = capture(
      ["0000_baseline.sql"],
      ["0001_old.sql", "0002_old.sql"],
    );

    const result = await call({ reset: true });

    expect(result.replaced).toBe(2);
    expect(commands.some((c) => c.includes("DELETE FROM d1_migrations"))).toBe(
      true,
    );
    expect(commands.some((c) => c.includes("--file="))).toBe(false);
  });

  it("refuses when more than one local migration exists", async ({
    expect,
  }) => {
    const { call } = capture(["0000_baseline.sql", "0001_extra.sql"], []);

    await expect(call()).rejects.toThrowError(/exactly one/);
  });

  /**
   * This is the exact command the (corrected) production runbook now runs
   * against Lore: one v1 baseline folder, nothing previously recorded.
   */
  describe("drizzle-kit v1 folder-per-migration layout", () => {
    it("baselines a v1 migration, recording the folder name", async ({
      expect,
    }) => {
      const { commands, call } = capture(
        [
          "20260729013337_baseline/migration.sql",
          "20260729013337_baseline/snapshot.json",
        ],
        [],
      );
      await call();

      expect(
        commands.some((c) =>
          c.includes(
            "INSERT INTO d1_migrations (name) VALUES ('20260729013337_baseline')",
          ),
        ),
      ).toBe(true);
      expect(commands.some((c) => c.includes("--file="))).toBe(false);
    });

    it("agrees with d1MigrationsApply on the recorded name for the same layout", async ({
      expect,
    }) => {
      // Baseline it first, and read back the exact string it recorded.
      const baselineRun = capture(
        ["20260729013337_baseline/migration.sql"],
        [],
      );
      await baselineRun.call();
      const insertCommand = baselineRun.commands.find((c) =>
        c.includes("INSERT INTO d1_migrations"),
      ) as string;
      const recordedName = insertCommand.match(/VALUES \('([^']+)'\)/)?.[1] as
        | string
        | undefined;

      // Then confirm a fresh `d1MigrationsApply` run, seeded with that
      // exact recorded name as "already applied", treats it as nothing
      // pending. If the two methods ever disagreed on the name, this would
      // re-run the baseline SQL against a live, already-baselined database.
      const applyCommands: string[] = [];
      class FakeShell {
        async run(command: string) {
          applyCommands.push(command);
          if (command.includes("SELECT name FROM d1_migrations")) {
            return JSON.stringify([{ results: [{ name: recordedName }] }]);
          }
          return "";
        }
      }
      const alepha = Alepha.create();
      const api = alepha.inject(WranglerApi);
      Object.assign(api as unknown as Record<string, unknown>, {
        shell: new FakeShell(),
        fs: new FakeFs(
          new Set([`${ROOT}/20260729013337_baseline/migration.sql`]),
        ),
      });
      await (
        api as unknown as {
          d1MigrationsApply: (
            db: string,
            root?: string,
            dir?: string,
          ) => Promise<void>;
        }
      ).d1MigrationsApply("mydb", ".", ROOT);

      expect(recordedName).toBe("20260729013337_baseline");
      expect(applyCommands.some((c) => c.includes("--file="))).toBe(false);
    });

    it("refuses to baseline a directory with no recognisable migrations", async ({
      expect,
    }) => {
      const { call } = capture(["README.md"], []);

      await expect(call()).rejects.toThrowError(
        /none are recognizable as migrations/,
      );
    });
  });
});
