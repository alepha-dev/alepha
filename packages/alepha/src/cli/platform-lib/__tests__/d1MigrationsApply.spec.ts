import { join as nodeJoin } from "node:path";

import { Alepha } from "alepha";
import { describe, it } from "vitest";

import type { CloudflareD1QueryResult } from "../services/CloudflareApi.ts";
import { D1MigrationsService } from "../services/D1MigrationsService.ts";

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
 * being caught, so this suite asserts the shape of what is sent directly
 * rather than trusting a comment.
 *
 * ⚠️ **The transport is the D1 query API now (#1514), not `wrangler d1
 * execute`.** The invariant is the same and the assertion moved with it: there
 * is no longer a command to check for, so what is checked is that each
 * migration file's SQL is posted **verbatim, in one request, with nothing
 * wrapped around it**. `BEGIN`/`COMMIT` appearing here, or a file split into
 * one request per statement, is the same bug wearing different clothes: either
 * takes a rebuild's `PRAGMA foreign_keys=OFF` out of force before its own
 * `DROP TABLE` runs.
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

  /**
   * A migration's contents, shaped like a real drizzle table rebuild: the
   * pragma, a statement breakpoint and the `DROP TABLE` the pragma exists to
   * protect. The `-- FILE` marker is what lets an assertion say WHICH file was
   * posted, the way `--file=` used to name it on the command line.
   */
  async readTextFile(path: string) {
    return [
      `-- FILE ${path}`,
      "PRAGMA foreign_keys=OFF;",
      "--> statement-breakpoint",
      "CREATE TABLE `__new_parent` (`id` integer PRIMARY KEY);",
      "--> statement-breakpoint",
      "DROP TABLE `parent`;",
    ].join("\n");
  }
}

/**
 * Every `sql` posted to the D1 query API, in order.
 *
 * The old fixture captured shell command lines; this captures request bodies,
 * which is both closer to what actually reaches Cloudflare and enough to see
 * a wrapper somebody added around a migration.
 */
class FakeCloudflareApi {
  public readonly sql: string[] = [];

  constructor(protected readonly appliedNames: string[] = []) {}

  async resolveD1Id(name: string) {
    return `uuid-of-${name}`;
  }

  async d1Query(_databaseId: string, sql: string) {
    this.sql.push(sql);
    if (sql.includes("SELECT name FROM d1_migrations")) {
      return [
        { results: this.appliedNames.map((name) => ({ name })) },
      ] as CloudflareD1QueryResult[];
    }
    return [] as CloudflareD1QueryResult[];
  }
}

/**
 * The migration files that were applied, named by path.
 */
const appliedFiles = (sql: string[]): string[] =>
  sql
    .map((it) => /^-- FILE (.+)$/m.exec(it)?.[1])
    .filter((it): it is string => Boolean(it));

describe("d1MigrationsApply", () => {
  const capture = (relativePaths: string[], appliedNames: string[] = []) => {
    const paths = new Set(relativePaths.map((p) => `${ROOT}/${p}`));
    const alepha = Alepha.create();
    const service = alepha.inject(D1MigrationsService);
    const api = new FakeCloudflareApi(appliedNames);
    // Swap the collaborators the method actually uses.
    Object.assign(service as unknown as Record<string, unknown>, {
      api,
      fs: new FakeFs(paths),
    });

    const call = () => service.apply("mydb", ".", ROOT);

    return { sql: api.sql, call };
  };

  it("wraps no migration in a transaction of its own", async ({ expect }) => {
    // The `wrangler d1 migrations apply` invariant, restated for the API
    // transport: what made that command destructive was the transaction it
    // opened, so the thing to refuse is a transaction and not a command name.
    const { sql, call } = capture(["0001_init.sql", "0002_rebuild.sql"]);
    await call();

    expect(sql.some((it) => /\bBEGIN\b/i.test(it))).toBe(false);
    expect(sql.some((it) => /\bCOMMIT\b/i.test(it))).toBe(false);
  });

  it("posts each pending migration file as one request, verbatim", async ({
    expect,
  }) => {
    const { sql, call } = capture(["0001_init.sql", "0002_rebuild.sql"]);
    await call();

    const applied = appliedFiles(sql);
    expect(applied).toEqual([
      "dist/migrations/0001_init.sql",
      "dist/migrations/0002_rebuild.sql",
    ]);

    // ⚠️ One request for the whole file. Splitting on `--> statement-breakpoint`
    // would put the pragma and the `DROP TABLE` it protects in separate
    // executions, which is the same data loss by another route.
    const rebuild = sql.find((it) => it.includes("0002_rebuild.sql")) as string;
    expect(rebuild).toContain("PRAGMA foreign_keys=OFF;");
    expect(rebuild).toContain("DROP TABLE `parent`;");
  });

  it("records each applied migration in wrangler's own table", async ({
    expect,
  }) => {
    const { sql, call } = capture(["0001_init.sql"]);
    await call();

    expect(
      sql.some((it) => it.includes("CREATE TABLE IF NOT EXISTS d1_migrations")),
    ).toBe(true);
    expect(
      sql.some(
        (it) =>
          it.includes("INSERT INTO d1_migrations") &&
          it.includes("0001_init.sql"),
      ),
    ).toBe(true);
  });

  it("applies migrations in sorted order regardless of directory order", async ({
    expect,
  }) => {
    const { sql, call } = capture(["0002_second.sql", "0001_first.sql"]);
    await call();

    const applied = appliedFiles(sql);
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
      const { sql, call } = capture([
        "20260729013337_baseline/migration.sql",
        "20260729013337_baseline/snapshot.json",
      ]);
      await call();

      expect(appliedFiles(sql)).toEqual([
        "dist/migrations/20260729013337_baseline/migration.sql",
      ]);

      expect(
        sql.some(
          (it) =>
            it.includes("INSERT INTO d1_migrations") &&
            it.includes("VALUES ('20260729013337_baseline')"),
        ),
      ).toBe(true);
      // The bookkeeping name must be the folder, never the literal
      // filename — `baseline` must record the exact same string for the two
      // methods to ever agree on "already applied".
      expect(sql.some((it) => it.includes("'migration.sql'"))).toBe(false);
    });

    it("applies pre-v1 and v1 migrations together, in chronological order", async ({
      expect,
    }) => {
      const { sql, call } = capture([
        "0000_old.sql",
        "20260729013337_baseline/migration.sql",
      ]);
      await call();

      const applied = appliedFiles(sql);
      expect(applied).toHaveLength(2);
      expect(applied[0]).toContain("0000_old.sql");
      expect(applied[1]).toContain("20260729013337_baseline/migration.sql");
    });

    it("does not re-run a v1 migration already recorded under its folder name", async ({
      expect,
    }) => {
      const { sql, call } = capture(
        ["20260729013337_baseline/migration.sql"],
        ["20260729013337_baseline"],
      );
      await call();

      expect(appliedFiles(sql)).toEqual([]);
      expect(sql.some((it) => it.includes("INSERT INTO d1_migrations"))).toBe(
        false,
      );
    });

    it("ignores a bare 'meta/' directory (pre-v1 journal/snapshots, no SQL)", async ({
      expect,
    }) => {
      // `meta/_journal.json` existing but nothing else in the directory —
      // legitimately nothing to apply, not an error.
      const { sql, call } = capture(["meta/_journal.json"]);
      await call();

      expect(appliedFiles(sql)).toEqual([]);
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
      const { sql, call } = capture([".archive/0000_old.sql"]);
      await call();

      expect(appliedFiles(sql)).toEqual([]);
    });

    it("ignores .archive/ when real migrations are present", async ({
      expect,
    }) => {
      const { sql, call } = capture([
        ".archive/0000_old.sql",
        "20260729013337_baseline/migration.sql",
      ]);
      await call();

      expect(appliedFiles(sql)).toEqual([
        "dist/migrations/20260729013337_baseline/migration.sql",
      ]);
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
    const paths = new Set(relativePaths.map((p) => `${ROOT}/${p}`));
    const alepha = Alepha.create();
    const service = alepha.inject(D1MigrationsService);
    const api = new FakeCloudflareApi(appliedNames);
    Object.assign(service as unknown as Record<string, unknown>, {
      api,
      fs: new FakeFs(paths),
    });

    const call = (opts?: { reset?: boolean }) =>
      service.baseline("mydb", ".", ROOT, opts);

    return { sql: api.sql, call };
  };

  it("inserts the baseline row and executes no migration file", async ({
    expect,
  }) => {
    const { sql, call } = capture(["0000_baseline.sql"], []);
    await call();

    expect(
      sql.some((it) =>
        it.includes(
          "INSERT INTO d1_migrations (name) VALUES ('0000_baseline.sql')",
        ),
      ),
    ).toBe(true);
    expect(appliedFiles(sql)).toEqual([]);
  });

  it("refuses to replace an existing history without reset", async ({
    expect,
  }) => {
    const { call } = capture(["0000_baseline.sql"], ["0001_old.sql"]);

    await expect(call()).rejects.toThrowError(/--reset/);
  });

  it("replaces an existing history when reset is given", async ({ expect }) => {
    const { sql, call } = capture(
      ["0000_baseline.sql"],
      ["0001_old.sql", "0002_old.sql"],
    );

    const result = await call({ reset: true });

    expect(result.replaced).toBe(2);
    expect(sql.some((it) => it.includes("DELETE FROM d1_migrations"))).toBe(
      true,
    );
    expect(appliedFiles(sql)).toEqual([]);
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
      const { sql, call } = capture(
        [
          "20260729013337_baseline/migration.sql",
          "20260729013337_baseline/snapshot.json",
        ],
        [],
      );
      await call();

      expect(
        sql.some((it) =>
          it.includes(
            "INSERT INTO d1_migrations (name) VALUES ('20260729013337_baseline')",
          ),
        ),
      ).toBe(true);
      expect(appliedFiles(sql)).toEqual([]);
    });

    it("agrees with apply on the recorded name for the same layout", async ({
      expect,
    }) => {
      // Baseline it first, and read back the exact string it recorded.
      const baselineRun = capture(
        ["20260729013337_baseline/migration.sql"],
        [],
      );
      await baselineRun.call();
      const insert = baselineRun.sql.find((it) =>
        it.includes("INSERT INTO d1_migrations"),
      ) as string;
      const recordedName = /VALUES \('([^']+)'\)/.exec(insert)?.[1];

      // Then confirm a fresh `apply` run, seeded with that exact recorded
      // name as "already applied", treats it as nothing pending. If the two
      // methods ever disagreed on the name, this would re-run the baseline
      // SQL against a live, already-baselined database.
      const alepha = Alepha.create();
      const service = alepha.inject(D1MigrationsService);
      const api = new FakeCloudflareApi([recordedName as string]);
      Object.assign(service as unknown as Record<string, unknown>, {
        api,
        fs: new FakeFs(
          new Set([`${ROOT}/20260729013337_baseline/migration.sql`]),
        ),
      });
      await service.apply("mydb", ".", ROOT);

      expect(recordedName).toBe("20260729013337_baseline");
      expect(appliedFiles(api.sql)).toEqual([]);
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
