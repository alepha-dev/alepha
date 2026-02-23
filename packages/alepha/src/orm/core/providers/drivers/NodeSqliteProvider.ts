import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  $atom,
  $env,
  $hook,
  $inject,
  $use,
  AlephaError,
  type Static,
  t,
} from "alepha";
import type { PgDatabase } from "drizzle-orm/pg-core";
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

const envSchema = t.object({
  DATABASE_URL: t.optional(t.text()),
});

/**
 * Configuration options for the Node.js SQLite database provider.
 */
export const nodeSqliteOptions = $atom({
  name: "alepha.postgres.node-sqlite.options",
  schema: t.object({
    path: t.optional(
      t.string({
        description:
          "Filepath or :memory:. If empty, provider will use DATABASE_URL from env.",
      }),
    ),
  }),
  default: {},
});

export type NodeSqliteProviderOptions = Static<typeof nodeSqliteOptions.schema>;

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
  protected readonly options = $use(nodeSqliteOptions);

  protected sqlite!: DatabaseSync;
  protected drizzleDb!: any;

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

  public override get db(): PgDatabase<any> {
    return this.drizzleDb as unknown as PgDatabase<any>;
  }

  public override get nativeConnection(): unknown {
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
   * connection with proper `await`, making async transactions safe.
   */
  public override async transactional<R>(fn: () => Promise<R>): Promise<R> {
    const existing = this.alepha.get("alepha.orm.tx");
    if (existing) {
      return fn();
    }

    // Set the tx marker to the drizzle db itself — SQLite transactions are
    // connection-scoped, so all operations on this connection participate.
    this.alepha.store.set("alepha.orm.tx", this.db as any, {
      skipEvents: true,
    });

    this.sqlite.exec("BEGIN");
    try {
      const result = await fn();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      this.alepha.store.set("alepha.orm.tx", undefined, { skipEvents: true });
    }
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    return this.drizzleDb.all(query);
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

      const filepath = this.url.replace("sqlite://", "").replace("sqlite:", "");

      if (filepath !== ":memory:" && filepath !== "") {
        const dir = dirname(filepath);
        if (dir) {
          await mkdir(dir, { recursive: true }).catch(() => null);
        }
      }

      this.sqlite = new DatabaseSync(filepath);

      this.initDrizzle();

      // Never migrate in serverless mode - migrations should be applied during deployment
      if (!this.alepha.isServerless()) {
        await this.migrate();
      }

      this.log.info(`SQLite database OK`, { at: filepath });
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

    const require = createRequire(import.meta.url);
    const {
      BetterSQLiteSession,
    } = require("drizzle-orm/better-sqlite3/session");
    const { SQLiteSyncDialect } = require("drizzle-orm/sqlite-core/dialect");
    const { BaseSQLiteDatabase } = require("drizzle-orm/sqlite-core/db");

    const dialect = new SQLiteSyncDialect();
    const session = new BetterSQLiteSession(this.sqlite, dialect, undefined, {
      logger: {
        logQuery: (query: string, params: unknown[]) => {
          this.log.trace(query, { params });
        },
      },
    });

    this.drizzleDb = new BaseSQLiteDatabase("sync", dialect, session);
    this.log.debug("Using node:sqlite with sync driver");
  }

  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    const { migrate } = createRequire(import.meta.url)(
      "drizzle-orm/better-sqlite3/migrator",
    );
    migrate(this.drizzleDb, { migrationsFolder });
  }
}
