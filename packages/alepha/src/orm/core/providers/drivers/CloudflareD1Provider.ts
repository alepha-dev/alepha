import { $env, $hook, $inject, AlephaError, t } from "alepha";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { SqliteModelBuilder } from "../../services/SqliteModelBuilder.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * D1Database interface matching Cloudflare's D1 API.
 */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(query: string): Promise<D1ExecResult>;
  dump(): Promise<ArrayBuffer>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number;
    served_by: string;
    internal_stats: unknown;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cloudflare D1 SQLite provider using Drizzle ORM.
 */
export class CloudflareD1Provider extends DatabaseProvider {
  protected readonly builder = $inject(SqliteModelBuilder);
  protected readonly env = $env(
    t.object({
      DATABASE_URL: t.string({
        description: "Expect to be 'd1://binding'",
      }),
    }),
  );

  protected d1?: D1Database;
  protected drizzleDb?: DrizzleD1Database;

  public get name() {
    return "sqlite";
  }

  public get driver() {
    return "d1";
  }

  public override readonly dialect = "sqlite";

  public override get url(): string {
    return this.env.DATABASE_URL;
  }

  public override get db(): PgDatabase<any> {
    if (!this.drizzleDb) {
      throw new AlephaError("D1 database not initialized");
    }

    return this.drizzleDb as unknown as PgDatabase<any>;
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    // Use `.all()` — it returns the row array directly, exactly like
    // NodeSqliteProvider / BunSqliteProvider's `execute`. `.run()` returns
    // drizzle's D1 result envelope (`{ results, success, meta }`), which
    // has no `.rows` property: the previous `const { rows } = …run(query)`
    // destructured `undefined`, so EVERY raw-SQL SELECT on D1
    // (`Repository.query`, `DatabaseProvider.run`) silently returned `[]`.
    return (this.db as any).all(query);
  }

  /**
   * D1 does not support SQL-level transactions (BEGIN/COMMIT/ROLLBACK).
   * It rejects these statements and requires the JS `batch()` API for atomic
   * multi-statement operations instead.
   *
   * @see https://developers.cloudflare.com/d1/worker-api/d1-database/#batch-statements
   * @see https://github.com/drizzle-team/drizzle-orm/issues/2463
   */
  public override get supportsTransactions(): boolean {
    return false;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      try {
        const [bindingName] = this.env.DATABASE_URL.replace("d1://", "").split(
          ":",
        );
        const cloudflareEnv = this.alepha.get("cloudflare.env") as
          | Record<string, unknown>
          | undefined;
        if (!cloudflareEnv) {
          throw new AlephaError(
            "Cloudflare Workers environment not found in Alepha store under 'cloudflare.env'.",
          );
        }

        const binding = cloudflareEnv[bindingName] as D1Database;
        if (!binding) {
          throw new AlephaError(
            `D1 binding '${bindingName}' not found in Cloudflare Workers environment.`,
          );
        }

        this.d1 = binding;

        // Dynamic import to avoid crashes when not on Cloudflare
        const { drizzle } = await import("drizzle-orm/d1");

        this.drizzleDb = drizzle(this.d1) as DrizzleD1Database;

        // Never migrate in serverless mode - D1 migrations must be applied
        // via `wrangler d1 migrations apply` before deployment
        if (!this.alepha.isServerless()) {
          await this.migrate();
        }

        this.log.info("Using Cloudflare D1 database");
      } catch (error) {
        // Log the full error for debugging since Cloudflare Workers
        // doesn't properly display error causes
        const errorMessage =
          error instanceof Error
            ? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
            : String(error);
        this.log.error(`D1 initialization failed: ${errorMessage}`);
        throw error;
      }
    },
  });

  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    this.log.debug(`Running D1 migrations from '${migrationsFolder}'...`);
    try {
      // Dynamic import for D1 migrator
      const { migrate } = await import("drizzle-orm/d1/migrator");
      await migrate(this.db as any, { migrationsFolder });
      this.log.debug("D1 migrations completed successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      throw new AlephaError(
        `D1 migration failed from '${migrationsFolder}': ${errorMessage}`,
        { cause: error },
      );
    }
  }

  /**
   * D1 doesn't support push-based schema sync.
   * Always use file-based migrations regardless of environment.
   */
  public override async migrate(): Promise<void> {
    const migrationsFolder = this.getMigrationsFolder();
    try {
      await this.executeMigrations(migrationsFolder);
    } catch (error) {
      if (this.alepha.isTest()) {
        this.log.warn(
          "D1 migrations failed in test environment - ensure migrations exist",
        );
      } else {
        throw error;
      }
    }
  }
}
