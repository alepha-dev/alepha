import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  $atom,
  $env,
  $hook,
  $inject,
  $store,
  AlephaError,
  type Infer,
  z,
} from "alepha";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BetterSQLite3RunResult } from "drizzle-orm/better-sqlite3/session";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";
import { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect";
import { DbError } from "../../errors/DbError.ts";
import { databaseEnvSchema } from "../../schemas/databaseEnvSchema.ts";
import { SqliteModelBuilder } from "../../services/SqliteModelBuilder.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

// HACK - Hide ExperimentalWarning about SQLite from Node.js to avoid spamming logs
// TODO: Remove when SQLite support is stable in Node.js

(() => {
  if (process?.emit) {
    const originalEmit = process.emit;
    process.emit = (event: any, warning: any, ...args: any[]) => {
      if (
        event === "warning" &&
        warning?.name === "ExperimentalWarning" &&
        warning?.message?.includes("SQLite")
      ) {
        return false;
      }
      return originalEmit.apply(process, [event, warning, ...args]);
    };
  }
})();

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = databaseEnvSchema;

/**
 * Configuration options for the Node.js SQLite database provider.
 */
export const nodeSqliteOptions = $atom({
  name: "alepha.postgres.node-sqlite.options",
  schema: z.object({
    path: z
      .string()
      .describe(
        "Filepath or :memory:. If empty, provider will use DATABASE_URL from env.",
      )
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

export type NodeSqliteProviderOptions = Infer<typeof nodeSqliteOptions.schema>;

declare module "alepha" {
  interface State {
    [nodeSqliteOptions.key]: NodeSqliteProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Node.js SQLite provider using `node:sqlite` (DatabaseSync).
 *
 * Uses drizzle-orm's `BetterSQLiteSession` (sync driver) with a shimmed
 * `node:sqlite` DatabaseSync — no native `better-sqlite3` package required.
 *
 * The session and migrator sub-modules of `drizzle-orm/better-sqlite3` are
 * imported directly, bypassing `driver.cjs` which has a top-level
 * `require("better-sqlite3")`.
 */
export class NodeSqliteProvider extends DatabaseProvider {
  protected readonly env = $env(envSchema);
  protected readonly builder = $inject(SqliteModelBuilder);
  protected readonly options = $store(nodeSqliteOptions);

  protected sqlite?: DatabaseSync;
  protected drizzleDb?: any;

  public get name() {
    return "sqlite";
  }

  public override readonly dialect = "sqlite";

  public override get url(): string {
    const path = this.options.path ?? this.env.DATABASE_URL;
    if (path) {
      if (path.startsWith("postgres://")) {
        throw new AlephaError(
          "Postgres URL is not supported for SQLite provider.",
        );
      }
      return path;
    }

    if (this.alepha.isTest() || this.alepha.isServerless()) {
      return ":memory:";
    } else {
      return "node_modules/.alepha/sqlite.db";
    }
  }

  public override get db(): PgAsyncDatabase<any> {
    return this.drizzleDb as unknown as PgAsyncDatabase<any>;
  }

  public override get nativeConnection(): unknown {
    return this.sqlite;
  }

  public override get usesSyncTransactions(): boolean {
    return true;
  }

  /**
   * Narrow `this.sqlite` to a connected handle, or throw with a clear
   * message. Every call site below runs after `connect()` in normal use
   * (either via the `start` hook or a CLI command's explicit
   * `connect?.()`) — this only fires if that invariant was violated, e.g.
   * a call after `close()` with no matching `connect()`.
   */
  protected requireSqlite(): DatabaseSync {
    if (!this.sqlite) {
      throw new AlephaError("Database not initialized");
    }
    return this.sqlite;
  }

  /**
   * SQLite transaction override.
   *
   * The base class uses `this.db.transaction()` which goes through drizzle's
   * better-sqlite3 driver. That driver wraps a synchronous `BEGIN`/`COMMIT`
   * around the callback, so async callbacks commit before the work finishes.
   *
   * This override uses direct `BEGIN`/`COMMIT`/`ROLLBACK` on the native
   * connection with proper `await`, making async transactions safe. Blocks
   * are serialized because the single shared connection can only hold one
   * transaction at a time.
   */
  public override async transactional<R>(fn: () => Promise<R>): Promise<R> {
    const existing = this.alepha.get("alepha.orm.tx");
    if (existing) {
      return fn();
    }

    const sqlite = this.requireSqlite();
    return this.runExclusiveNativeTransaction((sql) => sqlite.exec(sql), fn);
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    return this.drizzleDb.all(query);
  }

  /**
   * Open the sqlite connection outside the normal `start` lifecycle.
   *
   * CLI commands that load the app via `loadAlephaFromServerEntryFile` set
   * `ALEPHA_CLI_IMPORT`, which makes `run(alepha)` return before
   * `alepha.start()` — so nothing else opens this connection. Those commands
   * (e.g. `db baseline mark`) call this directly, matching the
   * `connect?()`/`close?()` pattern `db push --dry-run` already uses.
   */
  public override async connect(): Promise<void> {
    if (this.sqlite) {
      return;
    }

    const { DatabaseSync } = await import("node:sqlite");

    const filepath = this.url.replace("sqlite://", "").replace("sqlite:", "");

    if (filepath !== ":memory:" && filepath !== "") {
      const dir = dirname(filepath);
      if (dir) {
        await mkdir(dir, { recursive: true }).catch(() => null);
      }
    }

    this.sqlite = new DatabaseSync(filepath);

    this.initDrizzle();

    this.log.info(`Sqlite connection OK`, { at: filepath });
  }

  /**
   * Close the connection opened by {@link connect}, and clear the cached
   * handle and drizzle instance derived from it — otherwise a later
   * `connect()` would see `this.sqlite` still set and no-op, leaving the
   * provider holding a closed handle instead of reconnecting.
   */
  public override async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = undefined;
      this.drizzleDb = undefined;
    }
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.connect();

      // Never migrate in serverless mode - migrations should be applied during deployment
      if (!this.alepha.isServerless()) {
        await this.migrate();
      }
    },
  });

  /**
   * Shim `node:sqlite` DatabaseSync to be compatible with the `better-sqlite3`
   * Drizzle driver. DatabaseSync lacks `stmt.raw()` and `db.transaction()`.
   */
  protected shimDatabaseSync(): void {
    const db = this.sqlite as any;

    // Shim transaction() — better-sqlite3 returns a function keyed by behavior
    if (!db.transaction) {
      db.transaction = (fn: (...args: any[]) => any) => {
        const wrapped = (...args: any[]) => {
          db.exec("BEGIN");
          try {
            const result = fn(...args);
            db.exec("COMMIT");
            return result;
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        };
        wrapped.deferred = wrapped;
        wrapped.immediate = wrapped;
        wrapped.exclusive = wrapped;
        return wrapped;
      };
    }

    // Shim prepare() to add stmt.raw() on returned statements.
    //
    // node:sqlite returns objects from stmt.all(), but drizzle's better-sqlite3
    // driver expects arrays from stmt.raw().all(). We approximate this with
    // Object.values(row). However, JOIN queries produce duplicate column names
    // (e.g. "id" from both tables), and JavaScript objects collapse duplicate
    // keys — losing values and shifting the positional mapping.
    //
    // Fix: for SELECT queries containing a JOIN, rewrite the column list with
    // unique positional aliases (__c0, __c1, ...) so every column gets a
    // distinct key and Object.values() preserves all values in order.
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const aliased = NodeSqliteProvider.aliasSelectColumns(sql);
      const stmt = origPrepare(aliased);
      if (!stmt.raw) {
        stmt.raw = () => ({
          all: (...args: any[]) =>
            stmt.all(...args).map((row: any) => Object.values(row)),
          get: (...args: any[]) => {
            const row = stmt.get(...args);
            return row ? Object.values(row) : undefined;
          },
        });
      }
      return stmt;
    };
  }

  /**
   * For SELECT queries with JOINs, add unique positional aliases to each column
   * so that `Object.values()` preserves all values even when column names collide.
   *
   * Only rewrites when the query is a SELECT containing a JOIN keyword and the
   * column list has duplicate base names.
   */
  protected static aliasSelectColumns(sql: string): string {
    const trimmed = sql.trimStart();
    const lower = trimmed.toLowerCase();

    // Only rewrite SELECT queries that contain a JOIN
    if (!lower.startsWith("select ") || !/ join /i.test(trimmed)) {
      return sql;
    }

    // Find the FROM clause (word boundary, not inside quotes)
    const fromIdx = trimmed.search(/\bfrom\b/i);
    if (fromIdx === -1) return sql;

    const selectPart = trimmed.substring(0, fromIdx);
    const rest = trimmed.substring(fromIdx);

    // Extract the SELECT keyword (+ optional DISTINCT)
    const kw = selectPart.match(/^(\s*select\s+(?:distinct\s+)?)/i);
    if (!kw) return sql;

    const prefix = kw[0];
    const columnsPart = selectPart.substring(prefix.length).trim();

    // Split by top-level commas (not inside parentheses)
    const columns: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of columnsPart) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        columns.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) columns.push(cur.trim());

    if (columns.length <= 1) return sql;

    // Extract the trailing column name from each expression to check for duplicates
    const baseNames = columns.map((col) => {
      const m = col.match(/"(\w+)"\s*$/);
      return m ? m[1] : col;
    });

    const seen = new Set<string>();
    let hasDuplicates = false;
    for (const name of baseNames) {
      if (seen.has(name)) {
        hasDuplicates = true;
        break;
      }
      seen.add(name);
    }

    if (!hasDuplicates) return sql;

    // Alias every column with a unique positional name
    const aliased = columns.map((col, i) => `${col} as "__c${i}"`).join(", ");
    return `${prefix}${aliased} ${rest}`;
  }

  /**
   * Initialize Drizzle using the sync session from `drizzle-orm/better-sqlite3/session`
   * directly, bypassing `drizzle-orm/better-sqlite3/driver` which has a top-level
   * `require("better-sqlite3")`. The shimmed `node:sqlite` DatabaseSync is fully
   * compatible with the sync session — no native `better-sqlite3` package required.
   */
  protected initDrizzle(): void {
    this.shimDatabaseSync();

    const dialect = new SQLiteDialect();
    const session = new BetterSQLiteSession(
      this.requireSqlite(),
      dialect,
      {},
      {
        logger: {
          logQuery: (query: string, params: unknown[]) => {
            this.log.trace(query, { params });
          },
        },
      },
    );

    this.drizzleDb = new SQLiteAsyncDatabase<
      "sync",
      BetterSQLite3RunResult,
      {}
    >("sync", dialect, session, {});
    this.log.debug("Using node:sqlite with sync driver");
  }

  protected override async runMigrator(
    migrationsFolder: string,
    options?: { init?: boolean },
  ): Promise<{ exitCode?: string } | void> {
    // Foreign keys MUST be disabled for the duration of the migration, and
    // it MUST happen here rather than inside the migration SQL.
    //
    // SQLite silently ignores `PRAGMA foreign_keys` inside a transaction,
    // and drizzle wraps migrations in one — so the `PRAGMA foreign_keys=OFF`
    // that drizzle-kit emits at the top of a generated table-rebuild is a
    // no-op. Constraints therefore stay live, and because `DROP TABLE`
    // performs an implicit `DELETE FROM`, every `ON DELETE CASCADE` fires:
    // a rebuild of a parent table silently empties its children.
    //
    // That is not hypothetical. Regenerating a schema for one app produced
    // a migration that rebuilt `roadmap_items` and `team_members`, and
    // wiped 2434 rows across five child tables — capacity allocations,
    // availability, activity tracking, planning phases, skill allocations —
    // with no error and a "Migration OK" log line.
    //
    // Setting the pragma out here, before drizzle opens its transaction, is
    // the sequence SQLite's own "Making Other Kinds Of Table Schema Changes"
    // recipe prescribes.
    const sqlite = this.requireSqlite();
    const foreignKeysWereOn =
      (sqlite.prepare("PRAGMA foreign_keys").get() as any)?.foreign_keys === 1;

    if (foreignKeysWereOn) sqlite.exec("PRAGMA foreign_keys=OFF");
    try {
      const result = migrate(this.drizzleDb, { migrationsFolder, ...options });

      // A rebuild that dropped a parent without carrying its children over
      // would leave orphans. Surface that instead of shipping silent
      // corruption.
      const violations = sqlite
        .prepare("PRAGMA foreign_key_check")
        .all() as unknown[];
      if (violations.length > 0) {
        throw new DbError(
          `Migration left ${violations.length} foreign key violation(s); the database was not migrated cleanly`,
        );
      }

      return result;
    } finally {
      if (foreignKeysWereOn) sqlite.exec("PRAGMA foreign_keys=ON");
    }
  }
}
