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
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as sqliteProxyDrizzle } from "drizzle-orm/sqlite-proxy";
import { migrate as sqliteProxyMigrate } from "drizzle-orm/sqlite-proxy/migrator";
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

export interface BetterSqlite3Module {
  drizzle: (client: any, config?: any) => BetterSQLite3Database;
}

export interface BetterSqlite3MigratorModule {
  migrate: (
    db: BetterSQLite3Database,
    config: { migrationsFolder: string },
  ) => void;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Node.js SQLite provider using `node:sqlite` (DatabaseSync).
 *
 * Automatically selects the best Drizzle driver at startup:
 * - `better-sqlite3` driver when available (enables push sync + studio in dev)
 * - `sqlite-proxy` driver as fallback (zero native deps, suitable for prod)
 */
export class NodeSqliteProvider extends DatabaseProvider {
  public static importBetterSqlite3(): BetterSqlite3Module | undefined {
    try {
      return createRequire(import.meta.url)("drizzle-orm/better-sqlite3");
    } catch {
      // ignored
    }
  }

  public static importBetterSqlite3Migrator():
    | BetterSqlite3MigratorModule
    | undefined {
    try {
      return createRequire(import.meta.url)(
        "drizzle-orm/better-sqlite3/migrator",
      );
    } catch {
      // ignored
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly env = $env(envSchema);
  protected readonly builder = $inject(SqliteModelBuilder);
  protected readonly options = $use(nodeSqliteOptions);

  protected sqlite!: DatabaseSync;
  protected betterDb?: BetterSQLite3Database;
  protected proxyDb?: ReturnType<typeof sqliteProxyDrizzle>;

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
    if (this.betterDb) {
      return this.betterDb as unknown as PgDatabase<any>;
    }
    if (this.proxyDb) {
      return this.proxyDb as unknown as PgDatabase<any>;
    }
    throw new AlephaError("Database not initialized");
  }

  public override get nativeConnection(): unknown {
    return this.sqlite;
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    if (this.betterDb) {
      return this.betterDb.all(query);
    }

    // Proxy driver fallback: manually extract query and run through DatabaseSync
    const all = this.proxyDb!.all(query);
    const { sql, params, method } = all.getQuery();

    const start = performance.now();
    let result: Array<Record<string, unknown>> = [];

    try {
      const statement = this.sqlite.prepare(sql);
      if (method === "run") {
        statement.run(...(params as any[]));
        result = [];
      } else if (method === "get") {
        const data = statement.get(...(params as any[]));
        result = data ? [{ ...data }] : [];
      } else {
        result = statement.all(...(params as any[]));
      }

      this.logQuery(
        sql,
        params as unknown[],
        performance.now() - start,
        result.length,
      );
      return result;
    } catch (error) {
      this.logQuery(
        sql,
        params as unknown[],
        performance.now() - start,
        0,
        (error as Error).message,
      );
      throw error;
    }
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

      // Try better-sqlite3 driver first (enables push sync + studio)
      // Falls back to sqlite-proxy when better-sqlite3 is not installed
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

    // Shim prepare() to add stmt.raw() on returned statements
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
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

  protected initDrizzle(): void {
    const bs3 = NodeSqliteProvider.importBetterSqlite3();

    if (bs3) {
      this.shimDatabaseSync();
      this.betterDb = bs3.drizzle(this.sqlite as any, {
        logger: {
          logQuery: (query: string, params: unknown[]) => {
            this.log.trace(query, { params });
          },
        },
      });
      this.log.debug("Using better-sqlite3 driver");
    } else {
      this.log.debug(
        "better-sqlite3 not available, falling back to sqlite-proxy driver",
      );
      this.proxyDb = sqliteProxyDrizzle(
        async (sql: string, params: any[], method: string) => {
          const start = performance.now();
          const statement = this.sqlite.prepare(sql);

          try {
            if (method === "get") {
              const data = statement.get(...params);
              const rows = data ? [{ ...data }] : [];
              this.logQuery(
                sql,
                params,
                performance.now() - start,
                rows.length,
              );
              return { rows };
            }

            if (method === "run") {
              statement.run(...params);
              this.logQuery(sql, params, performance.now() - start, 0);
              return { rows: [] };
            }

            if (method === "all" || method === "values") {
              const rows = statement.all(...params);
              this.logQuery(
                sql,
                params,
                performance.now() - start,
                rows.length,
              );
              return {
                rows: rows.map((row) => Object.values(row)),
              };
            }

            throw new AlephaError(`Unsupported method: ${method}`);
          } catch (error) {
            this.logQuery(
              sql,
              params,
              performance.now() - start,
              0,
              (error as Error).message,
            );
            throw error;
          }
        },
      );
    }
  }

  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    if (this.betterDb) {
      const bs3Migrator = NodeSqliteProvider.importBetterSqlite3Migrator();
      if (bs3Migrator) {
        bs3Migrator.migrate(this.betterDb, { migrationsFolder });
        return;
      }
    }

    await sqliteProxyMigrate(
      this.proxyDb!,
      async (migrationQueries: string[]) => {
        this.log.debug("Executing migration queries", { migrationQueries });
        for (const query of migrationQueries) {
          this.sqlite.prepare(query).run();
        }
      },
      { migrationsFolder },
    );
  }
}
