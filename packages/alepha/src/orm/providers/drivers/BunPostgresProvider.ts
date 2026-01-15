import { $env, $hook, $inject, AlephaError, type Static, t } from "alepha";
import { $lock } from "alepha/lock";
import { $logger } from "alepha/logger";
import type { SQL as BunSQL } from "bun";
import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { DbError } from "../../errors/DbError.ts";
import { DbMigrationError } from "../../errors/DbMigrationError.ts";
import { PostgresModelBuilder } from "../../services/PostgresModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

const envSchema = t.object({
  /**
   * Main configuration for database connection.
   * Accept a string in the format of a Postgres connection URL.
   * Example: postgres://user:password@localhost:5432/database
   * or
   * Example: postgres://user:password@localhost:5432/database?sslmode=require
   */
  DATABASE_URL: t.optional(t.text()),

  /**
   * In addition to the DATABASE_URL, you can specify the postgres schema name.
   */
  POSTGRES_SCHEMA: t.optional(t.text()),
});

/**
 * Bun PostgreSQL provider using Drizzle ORM with Bun's native SQL client.
 *
 * This provider uses Bun's built-in SQL class for PostgreSQL connections,
 * which provides excellent performance on the Bun runtime.
 *
 * @example
 * ```ts
 * // Set DATABASE_URL environment variable
 * // DATABASE_URL=postgres://user:password@localhost:5432/database
 *
 * // Or configure programmatically
 * alepha.with({
 *   provide: DatabaseProvider,
 *   use: BunPostgresProvider,
 * });
 * ```
 */
export class BunPostgresProvider extends DatabaseProvider {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly kit = $inject(DrizzleKitProvider);
  protected readonly builder = $inject(PostgresModelBuilder);

  protected client?: BunSQL;
  protected bunDb?: BunSQLDatabase;

  public readonly dialect = "postgresql";

  public get name() {
    return "postgres";
  }

  /**
   * In testing mode, the schema name will be generated and deleted after the test.
   */
  protected schemaForTesting = this.alepha.isTest()
    ? this.env.POSTGRES_SCHEMA?.startsWith("test_")
      ? this.env.POSTGRES_SCHEMA
      : this.generateTestSchemaName()
    : undefined;

  public override get url() {
    if (!this.env.DATABASE_URL) {
      throw new AlephaError("DATABASE_URL is not defined in the environment");
    }

    return this.env.DATABASE_URL;
  }

  /**
   * Execute a SQL statement.
   */
  public override execute(
    statement: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      return this.db.execute(statement);
    } catch (error) {
      throw new DbError("Error executing statement", error);
    }
  }

  /**
   * Get Postgres schema used by this provider.
   */
  public override get schema(): string {
    if (this.schemaForTesting) {
      return this.schemaForTesting;
    }

    if (this.env.POSTGRES_SCHEMA) {
      return this.env.POSTGRES_SCHEMA;
    }

    return "public";
  }

  /**
   * Get the Drizzle Postgres database instance.
   */
  public override get db(): PgDatabase<any> {
    if (!this.bunDb) {
      throw new AlephaError("Database not initialized");
    }

    return this.bunDb as unknown as PgDatabase<any>;
  }

  protected override async executeMigrations(
    migrationsFolder: string,
  ): Promise<void> {
    const { migrate } = await import("drizzle-orm/bun-sql/migrator");
    await migrate(this.bunDb!, { migrationsFolder });
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.connect();

      // never migrate in serverless mode (vercel, netlify, ...)
      if (!this.alepha.isServerless()) {
        try {
          await this.migrateLock.run();
        } catch (error) {
          throw new DbMigrationError(error);
        }
      }
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      // cleanup test schema
      if (
        this.alepha.isTest() &&
        this.schemaForTesting &&
        this.schemaForTesting.startsWith("test_")
      ) {
        // Additional validation: schema name must only contain safe characters
        if (!/^test_[a-z0-9_]+$/i.test(this.schemaForTesting)) {
          throw new AlephaError(
            `Invalid test schema name: ${this.schemaForTesting}. Must match pattern: test_[a-z0-9_]+`,
          );
        }

        this.log.warn(`Deleting test schema '${this.schemaForTesting}' ...`);
        await this.execute(
          sql`DROP SCHEMA IF EXISTS ${sql.raw(this.schemaForTesting)} CASCADE`,
        );
        this.log.info(`Test schema '${this.schemaForTesting}' deleted`);
      }

      // close the connection
      await this.close();
    },
  });

  public async connect(): Promise<void> {
    this.log.debug("Connect ..");

    // Check if we're running in Bun
    if (typeof Bun === "undefined") {
      throw new AlephaError(
        "BunPostgresProvider requires the Bun runtime. Use NodePostgresProvider for Node.js.",
      );
    }

    const { drizzle } = await import("drizzle-orm/bun-sql");
    const { SQL } = await import("bun");

    // Create Bun SQL client
    this.client = new SQL(this.url);

    // Test connection
    await this.client.unsafe("SELECT 1");

    this.bunDb = drizzle({
      client: this.client,
      logger: {
        logQuery: (query: string, params: unknown[]) => {
          this.log.trace(query, { params });
        },
      },
    });

    this.log.info("Connection OK");
  }

  public async close(): Promise<void> {
    if (this.client) {
      this.log.debug("Close...");

      await this.client.close();

      this.client = undefined;
      this.bunDb = undefined;

      this.log.info("Connection closed");
    }
  }

  protected migrateLock = $lock({
    handler: async () => {
      await this.migrate();
    },
  });
}
