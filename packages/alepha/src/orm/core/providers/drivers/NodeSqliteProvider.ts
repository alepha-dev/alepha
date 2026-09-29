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
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import {
  type NodeSQLiteRunResult,
  NodeSQLiteSession,
} from "drizzle-orm/node-sqlite/session";
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
    // Captured to be restored, never called through this binding.
    // The signature is widened because process.emit is overloaded per event
    // name, and a spread apply() cannot select an overload.
    // oxlint-disable-next-line typescript/unbound-method
    const originalEmit = process.emit as (
      event: string,
      ...args: any[]
    ) => boolean;
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
 * Uses drizzle-orm's native `node-sqlite` session and migrator, so no native
 * SQLite addon is installed. The session is built here rather than through
 * `drizzle-orm/node-sqlite/driver`, whose top-level `import "node:sqlite"`
 * would load the module before `connect()` asks for it.
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
    }

    // `node_modules/.alepha/sqlite.db` is a development scratch path, and
    // production used to land on it silently. Three things follow from that,
    // and the third is the one that bit:
    //
    // - it is inside `node_modules`, so `npm ci` deletes the database;
    // - nothing backs it up, and nothing about the path suggests it holds data;
    // - `alepha dev` has already pushed the schema into that same file with an
    //   empty migrations journal, so a production boot replays every migration
    //   from the top and dies on the first `CREATE TABLE`.
    //
    // Requiring the variable matches the other production guards (APP_SECRET,
    // and the no-migrations error above): production states where its data
    // lives, or it does not start.
    //
    // Except when this process exists only to run migrations. `alepha db
    // migrations apply` boots the app with `NODE_ENV=production` on purpose —
    // that is what makes it take the file-based migration path rather than the
    // dev push — so refusing here would break the command in development, where
    // the scratch file IS the database the developer means. A deploy that
    // reaches this line with no `DATABASE_URL` still cannot serve: the server
    // boot that follows has no `MIGRATE` set and hits the throw above. Warn so
    // that detour leaves a trace rather than passing in silence.
    if (this.alepha.isProduction()) {
      if (!this.isMigrationRun()) {
        throw new AlephaError(
          "DATABASE_URL is required in production. Without it the SQLite provider falls back to 'node_modules/.alepha/sqlite.db', a development scratch file: it is deleted by 'npm ci', it is not backed up, and it already holds the schema 'alepha dev' pushed with an empty migrations journal — so migrations replay and fail. Set DATABASE_URL to a path outside the bundle (e.g. 'sqlite:///var/lib/myapp/db.sqlite') or to a postgres:// URL.",
        );
      }

      this.log.warn(
        "Migrating 'node_modules/.alepha/sqlite.db' — the development scratch database. Set DATABASE_URL if this was meant to migrate a deployed one.",
      );
    }

    return "node_modules/.alepha/sqlite.db";
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
   * sync node-sqlite session. It wraps a synchronous `BEGIN`/`COMMIT`
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

    // Switched off by a test (`DATABASE_TRANSACTIONS=false`): run bare, as
    // the base class and D1 do.
    if (!this.supportsTransactions) {
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
   * Initialize Drizzle on the native `node:sqlite` session. It reads JOIN rows
   * as arrays (`setReturnArrays`), so columns sharing a name keep their values.
   */
  protected initDrizzle(): void {
    const dialect = new SQLiteDialect();
    const session = new NodeSQLiteSession(
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

    this.gateSyncSession(session as never);
    this.drizzleDb = new SQLiteAsyncDatabase<"sync", NodeSQLiteRunResult, {}>(
      "sync",
      dialect,
      session,
      {},
    );
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
