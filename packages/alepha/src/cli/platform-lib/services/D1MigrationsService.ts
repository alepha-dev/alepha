import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type { CloudflareD1QueryResult } from "../schemas/cloudflare.ts";

/**
 * A single discovered D1 migration: the bookkeeping name recorded in
 * `d1_migrations.name`, and the SQL file to run for it.
 */
export interface D1Migration {
  name: string;
  sqlPath: string;
}

/**
 * Discovering, ordering, applying and recording D1 migrations.
 *
 * ⚠️ **The transport is the D1 query API, not wrangler**, which is the whole of
 * #1514. Everything else here is unchanged from when it lived on `WranglerApi`:
 * both migration layouts, the deterministic ordering, wrangler's own
 * `d1_migrations` bookkeeping table, and the loud refusal when a directory
 * holds entries that are not migrations.
 *
 * Two reasons the transport had to move. A Worker cannot spawn a process, and
 * `orchestrator.up()`'s migrate step is the one part of a Cloudflare deploy
 * that shelled out. And reading the applied set back as JSON beats scraping
 * `--json` output with a regular expression, which is what the shell path did.
 *
 * ⚠️ **The transport is an ARGUMENT, not an injected field.** It carries a
 * Cloudflare credential, and inside Lore's Worker that credential belongs to
 * the estate being deployed to rather than to the process - the same reason
 * `CloudflareDeployClient` takes its token and account id in its constructor.
 * Injecting `CloudflareApi` here also made this service unreachable from a
 * Worker at all, since that class pulls in `WranglerApi` and so
 * `node:child_process`.
 *
 * ⚠️ **The two transports are not interchangeable, and picking the wrong one
 * loses data silently.** A migration FILE goes through
 * {@link CloudflareApi.d1Import}, which is what `wrangler d1 execute --remote
 * --file` uses; the bookkeeping statements go through
 * {@link CloudflareApi.d1Query}, which is what `--command` uses. Measured
 * 2026-09-07 against a real D1 with a five-row CASCADE child: the query
 * endpoint kept 0 of 5, the import flow kept 5 of 5. `PRAGMA
 * foreign_keys=OFF` is void under the first and honoured under the second.
 */
export class D1MigrationsService {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * The name wrangler gives its own bookkeeping table, and the shape it
   * creates, so `wrangler d1 migrations list` keeps working against a database
   * this service has migrated.
   */
  protected static readonly BOOKKEEPING =
    "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);";

  protected async discoverD1Migrations(dir: string): Promise<D1Migration[]> {
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

    const migrations: D1Migration[] = [];
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
   * The names already recorded in `d1_migrations`.
   *
   * Read out of the API's own JSON. The shell path scraped `--json` output
   * with `/"name":\s*"([^"]+)"/g`, which would have matched a `name` column of
   * any other table that happened to be in the same output.
   */
  protected async appliedNames(
    api: D1MigrationTransport,
    databaseId: string,
  ): Promise<string[]> {
    const answer = await api.d1Query(
      databaseId,
      "SELECT name FROM d1_migrations;",
    );
    return answer
      .flatMap((it) => it.results ?? [])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string");
  }

  /**
   * Apply pending D1 migrations.
   */
  public async apply(
    api: D1MigrationTransport,
    dbName: string,
    root?: string,
    migrationsDir = "migrations/sqlite",
  ): Promise<void> {
    const databaseId = await api.resolveD1Id(dbName);
    await api.d1Query(databaseId, D1MigrationsService.BOOKKEEPING);

    const applied = new Set(await this.appliedNames(api, databaseId));

    const dir = this.fs.join(root ?? ".", migrationsDir);
    const migrations = await this.discoverD1Migrations(dir);

    const pending = migrations.filter((it) => !applied.has(it.name));
    if (pending.length === 0) {
      this.log.info("No pending D1 migrations");
      return;
    }

    for (const migration of pending) {
      this.log.info(`Applying ${migration.name} ...`);
      // ⚠️ The whole file, as one request. Splitting on statement boundaries
      // here would separate a rebuild's `PRAGMA foreign_keys=OFF` from the
      // `DROP TABLE` it exists to protect.
      const sql = await this.fs.readTextFile(migration.sqlPath);
      await api.d1Import(databaseId, sql);
      await api.d1Query(
        databaseId,
        `INSERT INTO d1_migrations (name) VALUES ('${this.escape(migration.name)}');`,
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
  public async baseline(
    api: D1MigrationTransport,
    dbName: string,
    root?: string,
    migrationsDir = "migrations/sqlite",
    opts: { reset?: boolean } = {},
  ): Promise<{ replaced: number }> {
    const databaseId = await api.resolveD1Id(dbName);
    await api.d1Query(databaseId, D1MigrationsService.BOOKKEEPING);

    const dir = this.fs.join(root ?? ".", migrationsDir);
    const migrations = await this.discoverD1Migrations(dir);

    if (migrations.length !== 1) {
      throw new AlephaError(
        `Expected exactly one migration in '${dir}' to baseline, found ${migrations.length}. Run 'alepha db baseline create' first.`,
      );
    }
    const baseline = (migrations[0] as D1Migration).name;

    const applied = await this.appliedNames(api, databaseId);

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
      await api.d1Query(databaseId, "DELETE FROM d1_migrations;");
    }

    await api.d1Query(
      databaseId,
      `INSERT INTO d1_migrations (name) VALUES ('${this.escape(baseline)}');`,
    );

    this.log.info(`Baseline '${baseline}' recorded as applied on '${dbName}'`);
    return { replaced: applied.length };
  }

  /**
   * A migration name is a filename, so it cannot contain a quote in practice;
   * doubling one is what keeps that a fact rather than an assumption.
   */
  protected escape(value: string): string {
    return value.replace(/'/g, "''");
  }
}

/**
 * What a migration run needs from a Cloudflare client, and nothing else.
 *
 * Named as an interface so this service can be driven by whichever client the
 * runtime has: `CloudflareApi` on a laptop, `CloudflareProvisionClient` inside
 * a Worker. Both satisfy it structurally.
 *
 * ⚠️ The two methods are not interchangeable - see the class doc. `d1Import` is
 * for a migration file, `d1Query` for the bookkeeping.
 */
export interface D1MigrationTransport {
  resolveD1Id(name: string): Promise<string>;
  d1Query(databaseId: string, sql: string): Promise<CloudflareD1QueryResult[]>;
  d1Import(databaseId: string, sql: string): Promise<void>;
}
