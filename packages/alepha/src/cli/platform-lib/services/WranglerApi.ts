import { $inject, AlephaError } from "alepha";
import { AlephaCliUtils, PackageManagerUtils } from "alepha/cli";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Wraps wrangler CLI commands that are kept as shell-outs.
 *
 * Only used for operations where wrangler provides value
 * beyond a raw API call: OAuth login, worker deploy (bundling/upload),
 * D1 migrations, and secret bulk push.
 */
export class WranglerApi {
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);

  protected async runShell(
    command: string,
    options: Parameters<ShellProvider["run"]>[1] = {},
  ) {
    const output = await this.shell.run(command, options);

    // When the caller captured the output, echo it to the log so the user
    // still sees it (uncaptured commands stream straight to the terminal).
    if (options.capture) {
      this.log.info(output);
    }

    return output;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /**
   * Ensure wrangler is installed in the project.
   */
  public async ensureInstalled(root: string): Promise<void> {
    await this.pm.ensureDependency(root, "wrangler", {
      dev: true,
      exec: async (cmd, opts) => {
        await this.utils.exec(cmd, opts);
      },
    });
  }

  /**
   * Check if the user is authenticated. Returns the whoami output.
   */
  public async whoami(): Promise<string> {
    return await this.runShell("wrangler whoami", {
      resolve: true,
      capture: true,
    });
  }

  /**
   * Open the browser-based OAuth login flow.
   */
  public async login(): Promise<void> {
    await this.runShell("wrangler login", { resolve: true });
  }

  /**
   * Get the current auth token from wrangler (auto-refreshes if expired).
   */
  public async getAuthToken(): Promise<string> {
    const output = await this.shell.run("wrangler auth token --json", {
      resolve: true,
      capture: true,
    });

    const parsed = JSON.parse(output) as { type: string; token: string };
    return parsed.token;
  }

  // -------------------------------------------------------------------------
  // Deploy
  // -------------------------------------------------------------------------

  /**
   * Deploy a worker via wrangler (handles bundling and upload).
   *
   * Returns the workers.dev URL if found in the output.
   */
  public async deploy(
    workerName: string,
    configPath: string,
    root?: string,
  ): Promise<string | undefined> {
    const output = await this.runShell(
      `wrangler deploy --name=${workerName} --no-bundle --config=${configPath}`,
      { resolve: true, capture: true, root },
    );

    const match = output.match(/https:\/\/[^\s]*\.workers\.dev/);
    return match?.[0];
  }

  // -------------------------------------------------------------------------
  // D1 Migrations
  // -------------------------------------------------------------------------

  /**
   * A single discovered D1 migration: the bookkeeping name recorded in
   * `d1_migrations.name`, and the SQL file to run for it.
   */
  protected async discoverD1Migrations(
    dir: string,
  ): Promise<Array<{ name: string; sqlPath: string }>> {
    // `ls` is a raw readdir and throws ENOENT for a missing directory — an
    // app with no migrations folder is a valid state, not an error.
    // `{ hidden: true }`: `ls` hides dotfiles by default, so a directory
    // holding only `.archive/` (baselining's own output, alongside the
    // empty `meta/` it leaves behind) would otherwise read back as an
    // EMPTY directory rather than an unusable one — indistinguishable from
    // "nothing to do" instead of failing the guard below.
    const entries = (await this.fs.exists(dir))
      ? await this.fs.ls(dir, { hidden: true })
      : [];

    const migrations: Array<{ name: string; sqlPath: string }> = [];
    const unrecognized: string[] = [];

    for (const raw of entries) {
      const entry = raw.split("/").pop() as string;

      // Pre-v1 drizzle-kit: flat `<name>.sql` files directly in the
      // directory. Still real for any project not yet baselined onto v1.
      if (entry.endsWith(".sql")) {
        migrations.push({ name: entry, sqlPath: this.fs.join(dir, entry) });
        continue;
      }

      // drizzle-kit v1: one folder per migration, `<tag>/migration.sql`.
      // The recorded name is the folder name — the only stable,
      // unambiguous identifier a v1 migration has (there is no longer a
      // `meta/_journal.json` `idx`/`tag` to key off).
      const nestedSqlPath = this.fs.join(dir, entry, "migration.sql");
      if (await this.fs.exists(nestedSqlPath)) {
        migrations.push({ name: entry, sqlPath: nestedSqlPath });
        continue;
      }

      // `meta/` is the pre-v1 layout's journal + snapshots directory — it
      // carries no migration SQL by design, not a sign anything is wrong.
      // `.archive/` is baselining's own output (see `archiveMigrations` in
      // `db.ts`) — visible now that `ls` above is called with
      // `{ hidden: true }`, and equally not a sign anything is wrong.
      if (entry === "meta" || entry === ".archive") {
        continue;
      }

      unrecognized.push(entry);
    }

    // The bug this guards against: an empty *discovery result* used to be
    // indistinguishable from an empty *directory*. drizzle-kit v1's folder
    // layout made that ambiguity real — every entry in the directory got
    // silently filtered out by the old flat-`.sql`-only filter, "0 pending
    // migrations" was reported, and a deploy would apply nothing while
    // claiming success. If there's something here and none of it looks
    // like a migration, that must be loud, not a cheerful no-op.
    //
    // This must fire whenever ANY entry is unrecognized, not only when
    // NOTHING was recognized. A directory with one valid migration next to
    // one corrupt folder (an aborted `generate`, a bad merge, a partial
    // checkout) used to pass silently — `migrations.length` was 1, so the
    // old `migrations.length === 0 &&` guard never fired, and the corrupt
    // folder was quietly dropped from the deploy while it reported success.
    if (unrecognized.length > 0) {
      throw new AlephaError(
        `'${dir}' contains ${unrecognized.length} ${unrecognized.length === 1 ? "entry" : "entries"} (${unrecognized.join(", ")}) but none are recognizable as migrations (expected '*.sql' or '<name>/migration.sql'). Refusing to silently apply nothing.`,
      );
    }

    // Deploy order depends on this. `localeCompare` with no locale pinned
    // uses the host's default locale and ICU collation, which orders case
    // and punctuation differently from plain code-unit order — the wrong
    // instrument for a deterministic ordering that decides whether a table
    // rebuild runs before its table exists. An explicit code-unit
    // comparator is locale-independent by construction.
    migrations.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return migrations;
  }

  /**
   * Apply D1 migrations remotely.
   */
  /**
   * Apply pending D1 migrations.
   *
   * Deliberately NOT `wrangler d1 migrations apply`. That command runs each
   * migration inside a transaction — its own help says "this migration will
   * be rolled back" on error — and SQLite **ignores `PRAGMA foreign_keys`
   * inside a transaction**. drizzle-kit opens every generated table-rebuild
   * with `PRAGMA foreign_keys=OFF` precisely to survive the `DROP TABLE`,
   * so under `migrations apply` that pragma is silently void, foreign keys
   * stay enforced, and `DROP TABLE` — which performs an implicit
   * `DELETE FROM` — cascades every child row away. The migration then
   * reports success.
   *
   * That is not theoretical: it destroyed 2434 rows across five tables in a
   * production deploy, from a schema change that touched none of them.
   *
   * Verified against a real D1, same migrations, same database:
   *   wrangler d1 migrations apply  -> 0 of 5 child rows survive
   *   wrangler d1 execute --file    -> 5 of 5 survive
   *
   * So we drive `execute --file` ourselves and keep wrangler's own
   * `d1_migrations` bookkeeping table, which stays compatible with
   * `wrangler d1 migrations list`. The trade-off is losing per-migration
   * rollback — which is what causes the bug, and is illusory for a table
   * rebuild anyway, since the original table is already gone.
   */
  public async d1MigrationsApply(
    dbName: string,
    root?: string,
    migrationsDir = "migrations/sqlite",
  ): Promise<void> {
    const run = (args: string) =>
      this.runShell(`wrangler d1 execute ${dbName} --remote ${args}`, {
        resolve: true,
        env: { CI: "1" },
        root,
        capture: true,
      });

    // Same shape wrangler creates, so `d1 migrations list` keeps working.
    await run(
      `--command="CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);"`,
    );

    const listed = await run(
      `--command="SELECT name FROM d1_migrations;" --json`,
    );
    const applied = new Set(
      [...String(listed).matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]),
    );

    const dir = this.fs.join(root ?? ".", migrationsDir);
    const migrations = await this.discoverD1Migrations(dir);

    const pending = migrations.filter((m) => !applied.has(m.name));
    if (pending.length === 0) {
      this.log.info("No pending D1 migrations");
      return;
    }

    for (const migration of pending) {
      this.log.info(`Applying ${migration.name} ...`);
      await run(`--file="${migration.sqlPath}"`);
      await run(
        `--command="INSERT INTO d1_migrations (name) VALUES ('${migration.name.replace(/'/g, "''")}');"`,
      );
    }

    this.log.info(`Applied ${pending.length} D1 migration(s)`);
  }

  /**
   * Record the baseline migration as applied on D1, without executing it.
   *
   * Mirrors drizzle's `migrate({ init: true })` guardrails for the wrangler
   * bookkeeping path: exactly one local migration, and an empty history
   * unless `reset` is explicitly given.
   *
   * `reset` rewrites bookkeeping rows only. No table data is read or written,
   * so it cannot lose application data — but it does discard the record of
   * which migrations were previously applied, which is why it is opt-in.
   */
  public async d1MigrationsBaseline(
    dbName: string,
    root?: string,
    migrationsDir = "migrations/sqlite",
    opts: { reset?: boolean } = {},
  ): Promise<{ replaced: number }> {
    const run = (args: string) =>
      this.runShell(`wrangler d1 execute ${dbName} --remote ${args}`, {
        resolve: true,
        env: { CI: "1" },
        root,
        capture: true,
      });

    await run(
      `--command="CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);"`,
    );

    const dir = this.fs.join(root ?? ".", migrationsDir);
    const migrations = await this.discoverD1Migrations(dir);

    if (migrations.length !== 1) {
      throw new AlephaError(
        `Expected exactly one migration in '${dir}' to baseline, found ${migrations.length}. Run 'alepha db baseline create' first.`,
      );
    }
    const baseline = (migrations[0] as { name: string }).name;

    const listed = await run(
      `--command="SELECT name FROM d1_migrations;" --json`,
    );
    const applied = [...String(listed).matchAll(/"name":\s*"([^"]+)"/g)].map(
      (m) => m[1] as string,
    );

    if (applied.length > 0 && !opts.reset) {
      throw new AlephaError(
        `Database '${dbName}' already has ${applied.length} recorded migration(s). Pass --reset to replace that history with the baseline (bookkeeping rows only; table data is never touched).`,
      );
    }

    if (applied.length > 0) {
      this.log.warn(
        `Replacing ${applied.length} recorded migration(s) on '${dbName}' with '${baseline}'`,
      );
      this.log.warn(`Previously recorded: ${applied.join(", ")}`);
      await run(`--command="DELETE FROM d1_migrations;"`);
    }

    await run(
      `--command="INSERT INTO d1_migrations (name) VALUES ('${baseline.replace(/'/g, "''")}');"`,
    );

    this.log.info(`Baseline '${baseline}' recorded as applied on '${dbName}'`);
    return { replaced: applied.length };
  }
}
