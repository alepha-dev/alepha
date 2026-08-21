import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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
import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

import { DbError } from "../../errors/DbError.ts";
import { databaseEnvSchema } from "../../schemas/databaseEnvSchema.ts";
import { SqliteModelBuilder } from "../../services/SqliteModelBuilder.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = databaseEnvSchema;

/**
 * Configuration options for the Bun SQLite database provider.
 */
export const bunSqliteOptions = $atom({
  name: "alepha.postgres.bun-sqlite.options",
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

export type BunSqliteProviderOptions = Infer<typeof bunSqliteOptions.schema>;

declare module "alepha" {
  interface State {
    [bunSqliteOptions.key]: BunSqliteProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Bun SQLite provider using Drizzle ORM with Bun's native SQLite client.
 *
 * This provider uses Bun's built-in `bun:sqlite` for SQLite connections,
 * which provides excellent performance on the Bun runtime.
 *
 * @example
 * ```ts
 * // Set DATABASE_URL environment variable
 * // DATABASE_URL=sqlite://./my-database.db
 *
 * // Or configure programmatically
 * alepha.with({
 *   provide: DatabaseProvider,
 *   use: BunSqliteProvider,
 * });
 *
 * // Or use options atom
 * alepha.store.mut(bunSqliteOptions, (old) => ({
 *   ...old,
 *   path: ":memory:",
 * }));
 * ```
 */
export class BunSqliteProvider extends DatabaseProvider {
  protected readonly env = $env(envSchema);
  protected readonly builder = $inject(SqliteModelBuilder);
  protected readonly options = $store(bunSqliteOptions);

  protected sqlite?: Database;
  protected bunDb?: SQLiteBunDatabase;

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
      return "node_modules/.alepha/bun-sqlite.db";
    }
  }

  public override get db(): PgAsyncDatabase<any> {
    if (!this.bunDb) {
      throw new AlephaError("Database not initialized");
    }

    return this.bunDb as unknown as PgAsyncDatabase<any>;
  }

  public override get nativeConnection(): unknown {
    return this.sqlite;
  }

  public override get usesSyncTransactions(): boolean {
    return true;
  }

  /**
   * Same rationale as `NodeSqliteProvider.transactional`: drizzle's bun-sqlite
   * driver wraps a synchronous `BEGIN`/`COMMIT` around the callback, so an
   * async callback would commit before its awaited work finishes and rollback
   * could never happen. Use awaited BEGIN/COMMIT/ROLLBACK on the native
   * connection, serialized on the single shared connection.
   */
  public override async transactional<R>(fn: () => Promise<R>): Promise<R> {
    const existing = this.alepha.get("alepha.orm.tx");
    if (existing) {
      return fn();
    }

    const sqlite = this.sqlite;
    if (!sqlite) {
      throw new AlephaError("Database not initialized");
    }

    return this.runExclusiveNativeTransaction((sql) => sqlite.run(sql), fn);
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    return (this.bunDb as SQLiteBunDatabase).all(query);
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

    // Check if we're running in Bun
    if (typeof Bun === "undefined") {
      throw new AlephaError(
        "BunSqliteProvider requires the Bun runtime. Use NodeSqliteProvider for Node.js.",
      );
    }

    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");

    const filepath = this.url.replace("sqlite://", "").replace("sqlite:", "");

    if (filepath !== ":memory:" && filepath !== "") {
      const dir = dirname(filepath);
      if (dir) {
        await mkdir(dir, { recursive: true }).catch(() => null);
      }
    }

    this.sqlite = new Database(filepath);

    this.bunDb = drizzle({
      client: this.sqlite,
      logger: {
        logQuery: (query: string, params: unknown[]) => {
          this.log.trace(query, { params });
        },
      },
    });

    this.log.info(`Using Bun SQLite database at ${filepath}`);
  }

  /**
   * Close the connection opened by {@link connect}.
   */
  public override async close(): Promise<void> {
    if (this.sqlite) {
      this.log.debug("Closing Bun SQLite connection...");
      this.sqlite.close();
      this.sqlite = undefined;
      this.bunDb = undefined;
      this.log.info("Bun SQLite connection closed");
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

  protected readonly onStop = $hook({
    on: "stop",
    priority: "last",
    handler: async () => {
      await this.close();
    },
  });

  protected override async runMigrator(
    migrationsFolder: string,
    options?: { init?: boolean },
  ): Promise<{ exitCode?: string } | void> {
    const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");

    // See NodeSqliteProvider.runMigrator for the full reasoning:
    // SQLite ignores `PRAGMA foreign_keys` inside a transaction, drizzle
    // wraps migrations in one, and `DROP TABLE` performs an implicit
    // `DELETE FROM` — so a generated table-rebuild silently cascades every
    // child row away. The pragma has to be set out here, before drizzle
    // opens its transaction.
    const foreignKeysWereOn =
      (this.sqlite!.query("PRAGMA foreign_keys").get() as any)?.foreign_keys ===
      1;

    if (foreignKeysWereOn) this.sqlite!.run("PRAGMA foreign_keys=OFF");
    try {
      const result = migrate(this.bunDb!, {
        migrationsFolder,
        ...options,
      });

      const violations = this.sqlite!.query("PRAGMA foreign_key_check").all();
      if (violations.length > 0) {
        throw new DbError(
          `Migration left ${violations.length} foreign key violation(s); the database was not migrated cleanly`,
        );
      }

      return result;
    } finally {
      if (foreignKeysWereOn) this.sqlite!.run("PRAGMA foreign_keys=ON");
    }
  }
}
